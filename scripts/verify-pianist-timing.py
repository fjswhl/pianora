"""Playwright E2E for Pianist timing. Writes the input/output MIDIs and a JSON report."""
import argparse
from collections import defaultdict, deque
import hashlib
import itertools
import json
import os
from pathlib import Path
from statistics import median

import mido
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:4173")
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--cases", nargs="+", choices=["full", "classical", "tempo"],
                    default=["full", "classical", "tempo"])
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)


def tempo_fixture(path):
    midi = mido.MidiFile(ticks_per_beat=480)
    track = midi.add_track()
    track.append(mido.MetaMessage("time_signature", numerator=3, denominator=4))
    track.append(mido.MetaMessage("set_tempo", tempo=750000))
    track.append(mido.Message("note_on", note=60, velocity=65, time=480))
    track.append(mido.Message("note_off", note=60, time=480))
    track.append(mido.MetaMessage("set_tempo", tempo=400000, time=480))
    for pitch in [64, 67, 69, 67] * 3:
        track.append(mido.Message("note_on", note=pitch, velocity=65))
        track.append(mido.Message("note_off", note=pitch, time=240))
    track.append(mido.Message("note_on", note=48, velocity=65, time=9600))
    track.append(mido.Message("note_off", note=48, time=9000))
    midi.save(path)


def read_notes(path):
    now = 0
    notes = []
    midi = mido.MidiFile(path)
    for msg in midi:
        now += msg.time
        if msg.type == "note_on" and msg.velocity:
            notes.append((msg.note, now, msg.velocity))
    return sorted(notes, key=lambda n: (n[0], n[1])), midi


def median_duration_ms(midi):
    open_notes = defaultdict(deque)
    durations = []
    now = 0
    for msg in midi:
        now += msg.time
        if msg.type == "note_on" and msg.velocity:
            open_notes[msg.note].append(now)
        elif msg.type in ("note_off", "note_on"):
            durations.append(now - open_notes[msg.note].popleft())
    return round(median(durations) * 1000, 1)


def timing_map(midi):
    events = []
    for track in midi.tracks:
        ticks = 0
        for msg in track:
            ticks += msg.time
            if msg.type in ("set_tempo", "time_signature"):
                value = msg.tempo if msg.type == "set_tempo" else [msg.numerator, msg.denominator]
                events.append((ticks / midi.ticks_per_beat, msg.type, value))
    return sorted(events)


def download(page, label, path):
    page.get_by_role("button", name=label, exact=True).click()
    with page.expect_download() as result:
        page.locator("#dlMidiBtn").click()
    result.value.save_as(path)


def measure(score_file, performance_file):
    reference, source = read_notes(score_file)
    strikes, rendered = read_notes(performance_file)
    assert [n[0] for n in strikes] == [n[0] for n in reference]
    assert timing_map(rendered) == timing_map(source)
    offsets = [b[1] - a[1] for a, b in zip(reference, strikes)]
    assert max(map(abs, offsets)) < 0.125
    assert abs(min(n[1] for n in strikes) - min(n[1] for n in reference)) < 0.003
    assert abs(rendered.length - source.length) < 0.55
    assert len(set(n[2] for n in strikes)) > 1
    assert max(map(abs, offsets)) > 0.002
    pairs = sorted(zip(reference, strikes), key=lambda pair: pair[0][1])
    chord_spreads = []
    for _, group in itertools.groupby(pairs, key=lambda pair: pair[0][1]):
        starts = [n[1] for _, n in group]
        if len(starts) > 1:
            chord_spreads.append(max(starts) - min(starts))
    assert max(chord_spreads, default=0) < 0.040
    score_duration = median_duration_ms(source)
    performed_duration = median_duration_ms(rendered)
    assert 0.50 * score_duration < performed_duration < 1.20 * score_duration
    return dict(notes=len(strikes), score_seconds=round(source.length, 3),
                generated_seconds=round(rendered.length, 3), tempo_map=timing_map(rendered),
                first_onset_seconds=round(min(n[1] for n in strikes), 3),
                median_score_note_ms=score_duration, median_generated_note_ms=performed_duration,
                median_abs_offset_ms=round(1000 * median(map(abs, offsets)), 1),
                max_abs_offset_ms=round(1000 * max(map(abs, offsets)), 1),
                max_chord_spread_ms=round(1000 * max(chord_spreads, default=0), 1),
                midi_sha256=hashlib.sha256(performance_file.read_bytes()).hexdigest())


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chrome"))
    context = browser.new_context(locale="zh-CN", accept_downloads=True)
    report = {}
    for case in args.cases:
        page = context.new_page()
        page.goto(args.url + "/#editor")
        source = None
        if case == "full":
            page.locator("#presetSelect").select_option("red_dust_inn")
        else:
            source = Path("artifacts/browser-models/inputs/classical.mid").resolve()
            if case == "tempo":
                source = args.output / "tempo-input.mid"
                tempo_fixture(source)
            page.locator("#fileInput").set_input_files(source)
        page.locator("#importedScoreCard").wait_for()
        page.locator("#performanceModel").select_option("pianist")
        page.locator("#renderBtn").click()
        page.wait_for_function("location.hash === '#studio' || document.querySelector('#errBox')",
                               timeout=1800000)
        assert page.url.endswith("#studio"), page.locator("#errBox").inner_text()
        score_file = args.output / f"{case}-score.mid"
        performance_file = args.output / f"{case}-pianist.mid"
        restored_file = args.output / f"{case}-restored.mid"
        download(page, "琶音还原版", restored_file)
        download(page, "原谱演奏", score_file)
        download(page, "AI 演绎", performance_file)
        report[case] = measure(score_file, performance_file)
        restored_notes, restored = read_notes(restored_file)
        reference, original = read_notes(score_file)
        assert [n[0] for n in restored_notes] == [n[0] for n in reference]
        assert timing_map(restored) == timing_map(original)
        assert abs(restored.length - original.length) < 0.55
        if source:
            assert timing_map(mido.MidiFile(source)) == timing_map(mido.MidiFile(score_file))
        else:
            assert report[case]["notes"] == 1218
            assert abs(report[case]["score_seconds"] - 269.333) < 0.01
            assert any(kind == "set_tempo" and abs(value - 666667) <= 1
                       for _, kind, value in report[case]["tempo_map"])
        print(case, report[case], flush=True)
        (args.output / "timing.json").write_text(json.dumps(report, indent=2) + "\n")
        page.close()
