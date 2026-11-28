"""Restore pinned, public-domain Mutopia sources for the catalog importer."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
args = parser.parse_args()
for score in json.loads(Path('catalog/collections/mutopia-piano.json').read_text())['scores']:
    target = args.directory / score['file']
    data = urlopen(score['upstream'], timeout=45).read()
    if hashlib.sha256(data).hexdigest() != score['sha256']:
        raise ValueError('Source checksum changed for ' + score['id'])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    print(score['id'], len(data))
