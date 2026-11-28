"""Browser E2E. Pass two MIDI or MusicXML excerpts (classical, pop) and a preview URL via PIANORA_URL."""
from collections import Counter
import argparse
import hashlib
import json
import os
import mido
import re
import time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("classical", type=Path)
parser.add_argument("pop", type=Path)
parser.add_argument("--models", nargs="+", default=["virtuosonet","pianist","dexter"])
parser.add_argument("--output", type=Path, default=Path("artifacts/browser-models"))
args = parser.parse_args()
args.output.mkdir(exist_ok=True, parents=True)
report = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chromium"))
    context = browser.new_context(accept_downloads=True)
    for model in args.models:
        for genre in ["classical", "pop"]:
            requests = []
            page = context.new_page()
            def observe(req):
                requests.append((req.method,urlsplit(req.url).path))
            context.on("request", observe)
            page.on("pageerror", lambda exc: print(str(exc),flush=True))
            page.goto(os.getenv("PIANORA_URL","http://127.0.0.1:4173") + "/#editor")
            source = getattr(args,genre)
            if source.is_dir():
                source = source / (genre + (".mid" if model=="pianist" else ".musicxml"))
            page.locator("#fileInput").set_input_files(source)
            expect(page.locator("#renderBtn")).to_be_enabled()
            page.locator("#performanceModel").select_option(model)
            begin = time.monotonic()
            page.locator("#renderBtn").click()
            page.wait_for_function("location.hash === '#studio' || !!document.querySelector('#errBox')",timeout=1800000)
            assert page.url.endswith("#studio"), page.locator("#errBox").inner_text()
            expect(page.locator("#takesBar option:checked")).to_contain_text(re.compile({"pianist":"Pianist Transformer","dexter":"DExter","virtuosonet":"VirtuosoNet"}[model]))
            with page.expect_download() as download:
                page.locator("#dlMidiBtn").click()
            file = args.output / f"{model}-{genre}.mid"
            download.value.save_as(file)
            data = file.read_bytes()
            assert data[:4] == b"MThd" and len(data)>50
            midi = mido.MidiFile(file)
            events = [event for track in midi.tracks for event in track]
            strikes = [e for e in events if e.type == "note_on" and e.velocity]
            velocities = [e.velocity for e in strikes]
            reference = source.with_suffix(".mid")
            if reference.exists():
                expected = Counter(e.note for track in mido.MidiFile(reference).tracks for e in track if e.type=="note_on" and e.velocity)
                assert Counter(e.note for e in strikes)==expected
            assert len(set(velocities))>1 and midi.length>0
            assert not [r for r in requests if r[0] not in ("GET","HEAD","OPTIONS")], requests
            packs = {path.split("/")[-1].split("-")[0] for _,path in requests if "/performance-packs/" in path}
            assert packs <= {model}, packs
            report.append(dict(model=model, genre=genre, source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                               seconds=round(time.monotonic()-begin,2), notes=len(strikes),
                               velocity_range=[min(velocities),max(velocities)], midi_seconds=round(midi.length,2),
                               cc64=sum(e.type=="control_change" and e.control==64 for e in events),
                               non_read_requests=sum(r[0] not in ("GET","HEAD","OPTIONS") for r in requests),
                               bytes=len(data),sha256=hashlib.sha256(data).hexdigest()))
            (args.output/"results.json").write_text(json.dumps(report,indent=2))
            print(report[-1],flush=True)
            context.remove_listener("request", observe)
            page.close()
