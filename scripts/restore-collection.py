"""Restore a catalog collection from its publishers, checking every score's SHA-256."""
import argparse
from collections import defaultdict
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from lilypond_edition import read_edition

parser = argparse.ArgumentParser()
parser.add_argument('manifest', type=Path)
parser.add_argument('directory', type=Path)
parser.add_argument('--pdmx-archive', type=Path)
args = parser.parse_args()
root = args.directory.resolve()
root.mkdir(parents=True, exist_ok=True)
manifest = json.loads(args.manifest.read_text())
rows = manifest['scores'] + manifest.get('attachments', [])


def save(row, data):
    path = (root / row['file']).resolve()
    if not path.is_relative_to(root) or hashlib.sha256(data).hexdigest() != row['sha256']:
        raise ValueError('Invalid target or checksum for ' + row['id'])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def fetch(url, target):
    subprocess.run(['curl', '-gfsSL', '--retry', '4', '--retry-all-errors',
                    '--connect-timeout', '30', url, '-o', str(target)], check=True)


def download(row):
    with tempfile.NamedTemporaryFile() as file:
        fetch(row['upstream'], file.name)
        save(row, Path(file.name).read_bytes())


def source_edition(group):
    url, editions = group
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        archive = directory / 'edition.tar.gz'
        fetch(url, archive)
        with tarfile.open(archive) as tar:
            members = [m for m in tar if m.isfile() and m.name.endswith(('.ly', '.ily'))]
            tar.extractall(directory, members=members, filter='data')
        folders = [p for p in directory.iterdir() if p.is_dir()]
        if len(folders) != 1:
            raise ValueError('Unexpected source archive structure ' + url)
        for row in editions:
            save(row, read_edition(folders[0], row['sourceEntry']))


members = {row['archiveMember'].lstrip('./'): row for row in rows if 'archiveMember' in row}
if members:
    archive = args.pdmx_archive or root / 'mxl.tar.gz'
    if not archive.exists():
        archive.parent.mkdir(parents=True, exist_ok=True)
        fetch('https://zenodo.org/records/15571083/files/mxl.tar.gz?download=1', archive)
    with tarfile.open(archive, 'r|gz') as tar:
        for entry in tar:
            row = members.pop(entry.name.lstrip('./'), None)
            if row:
                if not entry.isfile():
                    raise ValueError(entry.name)
                save(row, tar.extractfile(entry).read())
    if members:
        raise ValueError(f'Missing {len(members)} archived editions')

archives = defaultdict(list)
singles = []
for row in rows:
    if 'sourceArchive' in row:
        archives[row['sourceArchive']].append(row)
    elif 'archiveMember' not in row:
        singles.append(row)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    list(pool.map(source_edition, archives.items()))
    list(pool.map(download, singles))
print('Verified', len(rows), 'score files')
