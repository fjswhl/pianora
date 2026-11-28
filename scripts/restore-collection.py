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
import sys
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


# Pin the upstream convert-ly tool as well as the original notes for editions
# whose historical syntax needed conversion to match the browser compiler.
def prepare_converter(directory):
    version = '3596756be0fac1f81066a99d2054329212172b2d'
    files = {
        'scripts/convert-ly.py': 'ac175804dcc1c8b019d902c460b0a5015bc54577462f62284880c95d045bd1af',
        'python/convertrules.py': '68d1d18cafda1eee01731f174e70efc8c4477c3d9dd1161553638cdac8342017',
        'python/lilylib.py': '700edc0b8ac3651b96228d15109a691d12e5b72af97301f4768e91daaa6f1c40',
    }
    for name, digest in files.items():
        target = directory / Path(name).name
        fetch(f'https://raw.githubusercontent.com/lilypond/lilypond/{version}/{name}', target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise ValueError('Invalid converter checksum: ' + name)
    return directory / 'convert-ly.py'


def source_edition(group):
    url, editions = group
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        archive = directory / 'edition.tar.gz'
        fetch(url, archive)
        # MusicXML editions are self-contained. Read only the listed files
        # from the pinned repository archive, without unpacking its other assets.
        if all(row.get('scoreType') == 'MusicXML' for row in editions):
            wanted = {row['sourceEntry']: row for row in editions}
            with tarfile.open(archive, 'r|gz') as tar:
                for member in tar:
                    row = wanted.pop(member.name.partition('/')[2], None)
                    if row:
                        if not member.isfile():
                            raise ValueError(member.name)
                        save(row, tar.extractfile(member).read())
            if wanted:
                raise ValueError(f'Missing {len(wanted)} MusicXML files in {url}')
            return
        with tarfile.open(archive) as tar:
            members = [m for m in tar if m.isfile()]
            tar.extractall(directory, members=members, filter='data')
        folders = [p for p in directory.iterdir() if p.is_dir()]
        if len(folders) != 1:
            raise ValueError('Unexpected source archive structure ' + url)
        for row in editions:
            data = read_edition(folders[0], row['sourceEntry'], row.get('sourcePart'))
            if 'sourceSyntaxVersion' in row:
                if row['sourceSyntaxVersion'] != '2.26.0':
                    raise ValueError('Unknown target syntax')
                result = subprocess.run([sys.executable, str(converter), '--to=2.26.0', '-l', 'NONE', '-'],
                                        input=data, capture_output=True, check=True)
                data = b'% Updated to LilyPond 2.26.0 syntax with GNU convert-ly.\n' + result.stdout
            save(row, data)


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
with tempfile.TemporaryDirectory() as tmp, concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    converter = prepare_converter(Path(tmp)) if any('sourceSyntaxVersion' in row for row in rows) else None
    list(pool.map(source_edition, archives.items()))
    list(pool.map(download, singles))
print('Verified', len(rows), 'score files')
