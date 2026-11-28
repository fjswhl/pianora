"""Restore a verified collection outside the static build from its publisher and optional PDMX archive."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('manifest',type=Path)
parser.add_argument('directory',type=Path)
parser.add_argument('--pdmx-archive',type=Path)
args = parser.parse_args()
root = args.directory.resolve()
rows = json.loads(args.manifest.read_text())['scores']

def save(row, data):
    path = (root / row['file']).resolve()
    if not path.is_relative_to(root) or hashlib.sha256(data).hexdigest() != row['sha256']:
        raise ValueError('Invalid target or checksum for '+row['id'])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)

def download(row):
    data = subprocess.check_output(['curl','-gfsSL','--retry','4','--retry-all-errors','--max-time','90',row['upstream']])
    save(row, data)

members = {row['archiveMember'].lstrip('./'): row for row in rows if 'archiveMember' in row}
if members:
    archive = args.pdmx_archive or root / 'mxl.tar.gz'
    if not archive.exists():
        archive.parent.mkdir(parents=True,exist_ok=True)
        subprocess.run(['curl','-fsSL','--retry','3','https://zenodo.org/records/15571083/files/mxl.tar.gz?download=1','-o',str(archive)],check=True)
    with tarfile.open(archive, 'r|gz') as tar:
        for entry in tar:
            row = members.pop(entry.name.lstrip('./'), None)
            if row:
                if not entry.isfile(): raise ValueError(entry.name)
                save(row,tar.extractfile(entry).read())
    if members:raise ValueError(f'Missing {len(members)} archived editions')
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    list(pool.map(download,(row for row in rows if 'archiveMember' not in row)))
print('Verified',len(rows),'score files')
