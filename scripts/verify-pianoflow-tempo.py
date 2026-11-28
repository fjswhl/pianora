"""Render real scores in Chrome and measure the exported note timing. Requires playwright and mido."""
import argparse
import json
from collections import Counter
from pathlib import Path

import mido
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:4173")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
scores = Path(__file__).resolve().parents[1] / "catalog/seed/files"
cases = {
    "pathetique": (scores / "beethoven/beethoven_pathetique_3.ly").read_bytes(),
    "mozart": (scores / "mozart/mozart_sonata_k545_1.ly").read_bytes(),
    # Same phrase at two tempi with an opening rest and a silent measure at the change.
    "tempo-change": rb'''\version "2.24.0"
phrase = { c'4 d' e' f' | g'4 f' e' d' | }
\score { { \time 4/4 \tempo 4 = 180 r2 \repeat unfold 4 \phrase
            r1 \tempo 4 = 60 \repeat unfold 4 \phrase } \midi { } }
''',
}

def xml_measure(number, unit, dotted, bpm):
    notes = "".join(f"<note><pitch><step>{p}</step><octave>4</octave></pitch>"
                    "<duration>1</duration><type>quarter</type></note>" for p in "CDEF")
    return (f'<measure number="{number}"><attributes><divisions>1</divisions></attributes>'
            f"<direction><direction-type><metronome><beat-unit>{unit}</beat-unit>{dotted}"
            f"<per-minute>{bpm}</per-minute></metronome></direction-type></direction>{notes}</measure>")


cases["metronome"] = (
    '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name>'
    '</score-part></part-list><part id="P1">'
    + xml_measure(1, "half", "", 108) + xml_measure(2, "quarter", "<beat-unit-dot/>", 60)
    + "</part></score-partwise>"
).encode()


def read_track(page, label, path):
    page.get_by_role("button", name=label, exact=True).click()
    with page.expect_download() as event:
        page.locator("#dlMidiBtn").click()
    event.value.save_as(path)
    time = 0
    strikes = []
    for msg in mido.MidiFile(path):
        time += msg.time
        if msg.type == "note_on" and msg.velocity:
            strikes.append((time, msg.note))
        if msg.type in ("note_on", "note_off"):
            end = time
    return strikes, end


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="chrome")
    context = browser.new_context(locale="zh-CN", accept_downloads=True)
    report = {}
    for name, source in cases.items():
        page = context.new_page()
        page.goto(args.url.rstrip("/") + "/#editor", wait_until="domcontentloaded")
        expect(page.locator("#lyEditor")).not_to_have_value("", timeout=45000)
        extension = ".musicxml" if name == "metronome" else ".ly"
        page.locator("#fileInput").set_input_files(dict(name=name + extension, mimeType="text/plain", buffer=source))
        if extension == ".ly":
            expect(page.locator("#lyEditor")).to_have_value(source.decode().replace("\r\n", "\n"))
        else:
            page.locator("#importedScoreCard").wait_for()
        page.locator("#performanceModel").select_option("pianoflow")
        page.locator("#renderBtn").click()
        page.wait_for_function("location.hash === '#studio' || document.querySelector('#errBox')", timeout=360000)
        assert page.url.endswith("#studio"), page.locator("#errBox").inner_text()
        score, written = read_track(page, "原谱演奏", args.output / f"{name}-score.mid")
        ai, performed = read_track(page, "AI 演绎", args.output / f"{name}-ai.mid")
        restored, final = read_track(page, "琶音还原版", args.output / f"{name}-final.mid")
        assert Counter(p for _, p in score) == Counter(p for _, p in ai) == Counter(p for _, p in restored)
        assert 0.85 < performed / written < 1.15 and abs(final - performed) < 1
        assert abs(ai[0][0] - score[0][0]) < 0.01
        stride = 1 if name == "metronome" else 16
        sample = range(0, len(score) - stride, stride)
        ratios = [(ai[i+stride][0] - ai[i][0]) / (score[i+stride][0] - score[i][0]) for i in sample]
        assert max(ratios) - min(ratios) > 0.015, "local timing flattened"
        result = dict(notes=len(ai), score_seconds=round(written, 3), ai_seconds=round(performed, 3),
                      restored_seconds=round(final, 3), phrase_ratios=[round(v, 3) for v in ratios])
        if name == "tempo-change":
            assert len(ai) == 64
            for start in (0, 32):
                ratio = (ai[start+31][0] - ai[start][0]) / (score[start+31][0] - score[start][0])
                assert 0.85 < ratio < 1.15, (start, ratio)
            result["first_onset_seconds"] = round(ai[0][0], 3)
        if name == "metronome":
            assert abs(score[4][0] - 4 * 60 / 216) < 0.003
            assert abs(score[5][0] - score[4][0] - 60 / 90) < 0.003
        report[name] = result
        (args.output / "timing.json").write_text(json.dumps(report, indent=2) + "\n")
        print(name, written, performed, flush=True)
        page.close()
    browser.close()
