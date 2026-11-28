"""Export the inference-only graphs, using the original projects on PYTHONPATH."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn

parser = argparse.ArgumentParser()
parser.add_argument("model", choices=["dexter", "pianist", "virtuosonet"])
parser.add_argument("checkpoint", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
out = args.output / args.model
out.mkdir(exist_ok=True, parents=True)
torch.set_num_threads(3)


def export(name, module, inputs, names, outputs, axes=None):
    torch.onnx.export(module.eval(), inputs, str(out / (name + ".onnx")),
                      input_names=names, output_names=outputs, dynamic_axes=axes,
                      opset_version=17)


def metadata(data):
    def convert(x):
        if hasattr(x, "tolist"):
            return x.tolist()
        return list(x)
    (out / "config.json").write_text(json.dumps(data, default=convert, allow_nan=False))


def dexter():
    from model import ClassifierFreeDenoiser
    from omegaconf import OmegaConf
    net = ClassifierFreeDenoiser.load_from_checkpoint(
        str(args.checkpoint), map_location="cpu",
        training=OmegaConf.create({"mode": "epsilon", "target": "gen_noise"}),
        sampling=OmegaConf.create({"type": "cfdg_ddpm", "w": 1.2})).eval()

    class Denoise(nn.Module):
        def __init__(self):
            super().__init__()
            for key in ["input_projection", "diffusion_embedding", "residual_layers",
                        "skip_projection", "output_projection"]:
                setattr(self, key, getattr(net, key))
            self.condition_normalize = net.condition_normalize

        def forward(self, noise, score, step):
            return ClassifierFreeDenoiser.forward(self, noise, score, None, step)[0]

    export("denoise", Denoise(), (torch.rand(2, 1, 200, 5), torch.rand(2, 200, 4),
                                  torch.ones(2, dtype=torch.long)),
           ["noise", "score", "step"], ["epsilon"])
    metadata(dict(alpha=net.sqrt_alphas_cumprod.square(), mean=list(net.hparams.dataset_means),
                  std=list(net.hparams.dataset_stds)))


def pianist():
    from src.model.pianoformer import PianoT5Gemma
    from transformers.models.t5gemma.modeling_t5gemma import apply_rotary_pos_emb, eager_attention_forward
    net = PianoT5Gemma.from_pretrained(str(args.checkpoint), torch_dtype=torch.float32,
                                       attn_implementation="eager").eval()

    def project(proj, x):
        return proj(x).reshape(1, x.size(1), -1, 128).transpose(1, 2)

    class Encoder(nn.Module):
        def __init__(self):
            super().__init__()
            self.enc = net.get_encoder()
            self.cross = nn.ModuleList([l.cross_attn for l in net.get_decoder().layers])

        def forward(self, tokens):
            x = self.enc.embeddings(tokens) * self.enc.config.hidden_size ** .5
            pos = torch.arange(x.shape[1]).unsqueeze(0)
            rotation = self.enc.rotary_emb(x, pos)
            for layer in self.enc.layers:
                x = layer(x, rotation, None, pos)
            x = self.enc.norm(x)
            return torch.stack([project(p, x) for a in self.cross for p in (a.k_proj, a.v_proj)])

    class Step(nn.Module):
        def __init__(self):
            super().__init__()
            self.dec = net.get_decoder()
            self.head = net.lm_head

        def attend(self, attn, q, k, v):
            result, _ = eager_attention_forward(attn, q, k, v, None, scaling=attn.scaling,
                                                softcap=attn.attn_logit_softcapping)
            return attn.o_proj(result.reshape(1, 1, -1))

        def forward(self, token, position, cross, past):
            x = self.dec.embed_tokens(token) * self.dec.config.hidden_size ** .5
            rotation = self.dec.rotary_emb(x, position)
            present = []
            for i, layer in enumerate(self.dec.layers):
                a = layer.self_attn
                y = layer.pre_self_attn_layernorm(x)
                q, k = apply_rotary_pos_emb(project(a.q_proj, y), project(a.k_proj, y), *rotation)
                k = torch.cat((past[2*i], k), dim=2)
                v = torch.cat((past[2*i+1], project(a.v_proj, y)), dim=2)
                present.extend([k, v])
                x = x + layer.post_self_attn_layernorm(self.attend(a, q, k, v))
                a = layer.cross_attn
                q = project(a.q_proj, layer.pre_cross_attn_layernorm(x))
                x = x + layer.post_cross_attn_layernorm(self.attend(a, q, cross[2*i], cross[2*i+1]))
                x = x + layer.post_feedforward_layernorm(layer.mlp(layer.pre_feedforward_layernorm(x)))
            logits = self.head(self.dec.norm(x))
            cap = self.dec.config.final_logit_softcapping
            return cap * torch.tanh(logits / cap), torch.stack(present)

    tokens = torch.ones((1, 24), dtype=torch.long)
    encoder = Encoder().eval()
    cross = encoder(tokens)
    export("encoder", encoder, (tokens,), ["tokens"], ["cross"],
           {"tokens": {1: "tokens"}, "cross": {3: "notes"}})
    key_count = cross.shape[0]
    export("step", Step(), (tokens[:, :1], tokens[:, :1], cross, torch.zeros(key_count,1,4,2,128)),
           ["token", "position", "cross", "past"], ["logits", "present"],
           {"cross": {3: "notes"}, "past": {3: "past_length"}, "present": {3: "length"}})


def virtuoso():
    from virtuoso.model import VirtuosoNet
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    net = VirtuosoNet(checkpoint["network_params"], checkpoint["stats"])
    net.load_state_dict(checkpoint["state_dict"])
    net.eval()
    enc, dec = net.score_encoder, net.performance_decoder

    class Sequence(nn.Module):
        def __init__(self, rnn):
            super().__init__()
            self.rnn = rnn

        def forward(self, x):
            return self.rnn(x)[0]

    class Pool(nn.Module):
        def __init__(self, attention):
            super().__init__()
            self.attention = attention

        def forward(self, x):
            # Explicitly broadcast the padding mask across heads. Tracing the original
            # in-place boolean index mis-broadcasts it when a beat contains >1 note.
            attention = self.attention
            scores = attention.get_attention(x)
            weights = scores.masked_fill(x.sum(-1, keepdim=True) == 0, -1e10).softmax(dim=1)
            heads = x.reshape(1, -1, attention.num_head, attention.head_size)
            return (heads * weights.unsqueeze(-1)).sum(dim=1).flatten(1)

    class RecurrentStep(nn.Module):
        def __init__(self, rnn, linear):
            super().__init__()
            self.rnn = rnn
            self.linear = linear

        def forward(self, x, hidden):
            y, hidden = self.rnn(x, hidden)
            return self.linear(y), hidden

    for name, module, width in [
        ("embed", net.note_embedder, net.network_params.input_size),
        ("notes", Sequence(enc.lstm), 256), ("voices", Sequence(enc.voice_net), 256),
        ("beat_pool", Pool(enc.beat_attention), 1024), ("beats", Sequence(enc.beat_rnn), 1024),
        ("measure_pool", Pool(enc.measure_attention), 512), ("measures", Sequence(enc.measure_rnn), 512),
        ("result_pool", Pool(dec.result_for_tempo_attention), 10)]:
        axes = {"x": {1: "length"}}
        if "pool" not in name:
            axes["y"] = {1: "length"}
        export(name, module, (torch.rand(1, 3, width),), ["x"], ["y"], axes)
    for name, rnn, linear in [("measure_step",dec.measure_decoder.rnn,dec.measure_decoder.fc),
                              ("beat_step",dec.beat_tempo_forward,dec.beat_tempo_fc),
                              ("note_step",dec.output_lstm,dec.fc)]:
        export(name, RecurrentStep(rnn, linear), (torch.rand(1,1,rnn.input_size), torch.zeros(1,1,256)),
               ["x","hidden"], ["y","next"])
    export("style", dec.style_vector_expandor, (torch.zeros(1,1,16),), ["x"], ["y"])
    stats = net.stats
    metadata(dict(dims=stats["key_to_dim"]["input"], stats=stats["stats"], outputs=stats["output_keys"]))


with torch.inference_mode():
    {"pianist": pianist, "dexter": dexter, "virtuosonet": virtuoso}[args.model]()
