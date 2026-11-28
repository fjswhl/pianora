"""Convert NIFC's notated Humdrum editions directly to reproducible compressed MusicXML.
Run with Python 3.12, converter21 4.0.2 and music21 10.5.2. Input is a JSON list of
{source, target, credit}. Failed conversions are reported and return a nonzero status.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor
import io
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from urllib.parse import unquote, urlsplit
import zipfile

import converter21
import music21
from music21.musicxml.m21ToXml import GeneralObjectExporter

CONTAINER = b'''<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles>
</container>'''


def convert(job):
    try:
        converter21.register()
        # Parse the original notation, including voices, rests and expressive markings.
        # An in-memory parse also avoids path-dependent music21 pickle caches.
        score = music21.converter.parseData(Path(job['source']).read_text(), format='humdrum')
        exporter = GeneralObjectExporter(score)
        exporter.makeNotation = False
        xml = ET.fromstring(exporter.parse())
        parts = xml.findall('part')
        pitches = len(xml.findall('.//note/pitch'))
        if not parts or pitches < 32 or max(len(p.findall('measure')) for p in parts) < 4:
            raise ValueError('incomplete or empty score')
        identification = xml.find('identification')
        encoding = identification.find('encoding')
        rights = ET.Element('rights')
        rights.text = job['credit']
        identification.insert(list(identification).index(encoding), rights)
        # music21 supplies the current date and random part/instrument IDs.
        date = encoding.find('encoding-date')
        if date is not None:
            encoding.remove(date)
        ET.SubElement(encoding, 'encoding-description').text = 'MusicXML converted directly from the notated Humdrum edition by Pianora.'
        replacements = {}
        for element in xml.iter():
            ident = element.get('id', '')
            if re.fullmatch('[A-Za-z][0-9a-fA-F]{32}', ident):
                element.set('id', replacements.setdefault(ident, f'{ident[0]}{len(replacements)+1}'))
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for name, content in [('META-INF/container.xml', CONTAINER),
                                  ('score.musicxml', ET.tostring(xml, encoding='utf-8', xml_declaration=True))]:
                entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                archive.writestr(entry, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
        target = Path(job['target'])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data.getvalue())
        return None
    except Exception as exc:
        return f"{job['source']}: {type(exc).__name__}: {exc}"


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('jobs', type=Path)
    parser.add_argument('--sources', type=Path, help='Use a collection manifest and local publisher checkouts instead of a job list')
    parser.add_argument('--output-directory', type=Path)
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args()
    jobs = json.loads(args.jobs.read_text())
    if args.sources:
        if not args.output_directory:
            parser.error('--sources requires --output-directory')
        jobs = []
        for row in json.loads(args.jobs.read_text())['scores']:
            owner, repo, blob, revision, entry = unquote(urlsplit(row['sourceUrl']).path).lstrip('/').split('/', 4)
            if owner != 'pl-wnifc' or blob != 'blob' or not re.fullmatch('[0-9a-f]{40}', revision):
                raise ValueError(row['sourceUrl'])
            jobs.append(dict(source=args.sources / repo / entry, target=args.output_directory / row['file'],
                             credit=row['edition']))
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        errors = list(filter(None, pool.map(convert, jobs)))
    for error in errors:
        print(error, file=sys.stderr)
    sys.exit(bool(errors))
