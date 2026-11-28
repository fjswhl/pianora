"""Package exported graphs for the existing browser pack reader. Usage: pack.py GRAPH_DIR"""
import gzip
import hashlib
import json
from pathlib import Path
import sys
from onnxruntime.quantization import quantize_dynamic, QuantType

root = Path(__file__).resolve().parents[2]
source = Path(sys.argv[1])
output = root / 'public' / 'performance-packs'
output.mkdir(exist_ok=True)
manifest_path = root / 'src/engine/performance/graphs.json'
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
size = 8 * 1024 * 1024
for model in sys.argv[2:] or ['pianist', 'virtuosonet', 'dexter']:
    config = source / model / 'config.json'
    if config.exists():
        (root / 'src/engine/performance' / (model + '.json')).write_bytes(config.read_bytes())
    for path in sorted((source / model).glob('*.onnx')):
        name = model + '-' + path.stem
        if model == 'pianist':
            # Int8 linear projections reduce both decoder bandwidth and WASM compute time.
            quantized = source / (name + '.int8.onnx')
            quantize_dynamic(str(path), str(quantized), weight_type=QuantType.QInt8,
                             op_types_to_quantize=['MatMul'], extra_options={'MatMulConstBOnly':True})
            path = quantized
        raw = path.read_bytes()
        parts = []
        for off in range(0, len(raw), size):
            part = raw[off:off+size]
            packed = gzip.compress(b''.join(part[i::4] for i in range(4)), compresslevel=4, mtime=0)
            digest = hashlib.sha256(packed).hexdigest()
            (output / (name + '-' + digest + '.pack')).write_bytes(packed)
            parts.append(digest)
        manifest[name] = dict(size=len(raw), chunkSize=size, stride=4, parts=parts,
                              revision=hashlib.md5(raw).hexdigest())
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
