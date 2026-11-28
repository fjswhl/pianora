"""Prepare a publisher's LilyPond score as one editable file for the browser."""
from pathlib import Path
import re

INCLUDE = re.compile(r'(?m)^([ \t]*)\\include\s+"([^"\n]+)"')


def read_edition(root, entry):
    root = Path(root).resolve()
    main = (root / entry).resolve()

    def expand(path, parents):
        if not path.is_relative_to(root) or path in parents:
            raise ValueError(f'Invalid LilyPond include in {entry}')
        data = path.read_bytes()
        try:
            source = data.decode('utf-8-sig')
        except UnicodeDecodeError:
            source = data.decode('latin-1')

        def insert(match):
            name = match[2]
            for directory in (path.parent, main.parent):
                child = (directory / name).resolve()
                if not child.is_relative_to(root):
                    continue
                if not child.is_file() and child.parent.is_dir():
                    # Some historical editions used capitals that differ from the archive.
                    matches = [f for f in child.parent.iterdir() if f.name.casefold() == child.name.casefold()]
                    if len(matches) == 1:
                        child = matches[0].resolve()
                if child.is_relative_to(root) and child.is_file():
                    return '\n' + expand(child, parents | {path}) + '\n'
            # Language names and LilyPond's standard library are supplied by the compiler.
            return match[0]

        return INCLUDE.sub(insert, source.replace('\r\n','\n'))

    note = '% Pianora edition: local includes expanded into one file for browser use.\n'
    return (note + expand(main, set())).encode('utf-8')
