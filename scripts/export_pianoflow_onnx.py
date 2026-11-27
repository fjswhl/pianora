"""
Export SyMuPe/PianoFlow-base core TupleTransformer to FP32 ONNX (`public/models/pianoflow_step_fp32.onnx`)
and dump exact tokenizer quantization tables (`public/models/pianoflow_tokenizer_meta.json`).

Requirements:
    pip install symupe torch onnx onnxruntime
"""
import json
import sys
import types
from pathlib import Path

# Compatibility shim for Windows (symupe imports Unix-only `resource` inside parangonar)
if "resource" not in sys.modules:
    dummy = types.ModuleType("resource")
    dummy.RLIMIT_AS = 0
    dummy.getrlimit = lambda *a, **kw: (0, 0)
    dummy.setrlimit = lambda *a, **kw: None
    sys.modules["resource"] = dummy

import numpy as np
import onnxruntime as ort
import torch
import torch.nn as nn
import torch.nn.functional as F
from symupe import AutoGenerator
from symupe.modules.transformer.attend import Attend
from symupe.modules.transformer.embeddings import DiscreteContinuousEmbedding
from symupe.modules.transformer.normalization import AdaptiveLayerNorm, LayerNorm


def patch_modules_for_onnx(root: nn.Module):
    """Make LayerNorm, AdaptiveLayerNorm, Attend, and DiscreteContinuousEmbedding ONNX dynamic-shape safe."""
    for m in root.modules():
        if isinstance(m, LayerNorm):
            def _ln_fwd(x, _m=m):
                return F.layer_norm(x, (_m.dim,), _m.weight, _m.bias, eps=_m.eps)
            m.forward = _ln_fwd
        elif isinstance(m, AdaptiveLayerNorm):
            def _aln_fwd(x, condition, _m=m):
                if condition.ndim == 2:
                    condition = condition.unsqueeze(1)
                w = _m.weight(condition)
                b = _m.bias(condition) if _m.bias is not None else 0.0
                return w * F.layer_norm(x, (_m.dim,), None, None, eps=_m.eps) + b
            m.forward = _aln_fwd
        elif isinstance(m, Attend):
            m.efficient = False
        elif isinstance(m, DiscreteContinuousEmbedding):
            tw = m.token_weight.detach().clone() if m.has_discrete else None

            def _emb_fwd(tokens=None, values=None, _m=m, _tw=tw):
                token_emb = F.embedding(tokens, _tw, _m.padding_idx) if _m.has_discrete else 0.0
                if not _m.continuous or values is None:
                    return token_emb
                v_emb = _m.value_layer(values.reshape(-1, 1)).reshape(
                    tokens.shape[0], tokens.shape[1], _m.embedding_dim
                )
                if _m.activation is not None:
                    v_emb = _m.activation(v_emb)
                if _m.num_first_discrete > 0:
                    keep = (tokens >= _m.num_first_discrete).unsqueeze(-1).to(v_emb.dtype)
                    v_emb = v_emb * keep
                return token_emb + v_emb

            m.forward = _emb_fwd


class PianoFlowStepONNX(nn.Module):
    def __init__(self, core_model: nn.Module):
        super().__init__()
        self.core = core_model

    def forward(
        self,
        tokens: torch.Tensor,
        values: torch.Tensor,
        vectors: torch.Tensor,
        time_steps: torch.Tensor,
        mask: torch.Tensor,
    ) -> torch.Tensor:
        out = self.core(
            tokens=tokens,
            values=values,
            vectors=vectors,
            time_steps=time_steps,
            mask=mask,
        )
        return out.values.float()


def main():
    out_dir = Path(__file__).resolve().parent.parent / "public" / "models"
    out_dir.mkdir(parents=True, exist_ok=True)

    print("Loading SyMuPe/PianoFlow-base on CPU for ONNX export...")
    gen = AutoGenerator.from_pretrained("SyMuPe/PianoFlow-base", device="cpu")
    gen.model.eval()
    cfm = gen.model.transformer
    core = cfm.model
    core.eval()
    patch_modules_for_onnx(core)

    wrapper = PianoFlowStepONNX(core).eval()

    # Pre-warm rotary caches up to L=300 before tracing
    with torch.no_grad():
        _ = wrapper(
            torch.ones((1, 300, 8), dtype=torch.int64),
            torch.zeros((1, 300, 8), dtype=torch.float32),
            torch.zeros((1, 300, 4), dtype=torch.float32),
            torch.tensor([0.5], dtype=torch.float32),
            torch.ones((1, 300), dtype=torch.bool),
        )

    torch.manual_seed(0)
    B, L = 1, 64
    tokens = torch.ones((B, L, 8), dtype=torch.int64)
    tokens[0, 0, :] = 2
    tokens[0, 1:, 0] = 60
    tokens[0, 1:, 1] = 10
    tokens[0, 1:, 2] = 10
    tokens[0, 1:, 3] = 20
    values = torch.full((B, L, 8), -101.0, dtype=torch.float32)
    values[0, 0, :] = -102.0
    values[0, 1:, 0] = 60.0 / 127.0
    values[0, 1:, 1] = 0.0
    values[0, 1:, 2] = 0.25
    values[0, 1:, 3] = 0.5
    vectors = torch.randn((B, L, 4), dtype=torch.float32)
    time_steps = torch.tensor([0.35], dtype=torch.float32)
    mask = torch.ones((B, L), dtype=torch.bool)

    with torch.no_grad():
        pt_out = wrapper(tokens, values, vectors, time_steps, mask).numpy()

    onnx_fp32 = out_dir / "pianoflow_step_fp32.onnx"
    print(f"Exporting FP32 ONNX -> {onnx_fp32}")
    torch.onnx.export(
        wrapper,
        (tokens, values, vectors, time_steps, mask),
        str(onnx_fp32),
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=["tokens", "values", "vectors", "time_steps", "mask"],
        output_names=["u_t"],
        dynamic_axes={
            "tokens": {0: "batch", 1: "seq_len"},
            "values": {0: "batch", 1: "seq_len"},
            "vectors": {0: "batch", 1: "seq_len"},
            "time_steps": {0: "batch"},
            "mask": {0: "batch", 1: "seq_len"},
            "u_t": {0: "batch", 1: "seq_len"},
        },
        dynamo=False,
    )

    sess = ort.InferenceSession(str(onnx_fp32), providers=["CPUExecutionProvider"])
    ort_out = sess.run(
        ["u_t"],
        {
            "tokens": tokens.numpy(),
            "values": values.numpy(),
            "vectors": vectors.numpy(),
            "time_steps": time_steps.numpy(),
            "mask": mask.numpy(),
        },
    )[0]
    diff = float(np.max(np.abs(pt_out - ort_out)))
    print(f"Exported {onnx_fp32.stat().st_size / 1e6:.2f} MB (max abs diff vs PyTorch: {diff:.2e})")
    assert diff < 1e-4, "ONNX numerical mismatch!"

    tok = gen.tokenizer
    norm_vals = tok.token_values(normalize=True)
    raw_vals = tok.token_values(normalize=False)
    tok_meta = {
        "token_types": cfm.token_types,
        "value_keys": cfm.value_keys,
        "value_indices": cfm.value_indices,
        "value_mean": [float(x) for x in cfm.value_mean.tolist()],
        "value_std": [float(x) for x in cfm.value_std.tolist()],
        "sigma": float(cfm.sigma),
        "special_tokens": tok.special_tokens_dict,
        "special_tokens_value": -100.0,
        "max_num_pos_per_beat": int(getattr(tok.config, "max_num_pos_per_beat", 24)),
        "pitch_range": list(getattr(tok.config, "pitch_range", [21, 108])),
        "token_values_norm": {k: [float(x) for x in norm_vals[k].tolist()] for k in cfm.token_types},
        "token_values_raw": {k: [float(x) for x in raw_vals[k].tolist()] for k in cfm.token_types},
    }
    meta_path = out_dir / "pianoflow_tokenizer_meta.json"
    meta_path.write_text(json.dumps(tok_meta, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote tokenizer metadata -> {meta_path} ({meta_path.stat().st_size / 1e3:.1f} KB)")


if __name__ == "__main__":
    main()
