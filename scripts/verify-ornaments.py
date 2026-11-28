"""Upload the same ornamented passage in two formats and inspect the studio's MIDI downloads."""
import argparse
import json
from pathlib import Path

import mido
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:4173")
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--quick", action="store_true", help="only run the two short fixtures")
parser.add_argument("--goldberg-only", action="store_true", help="verify the catalog Aria's opening compound ornament")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
scores = {"trill.ly": r'''\version "2.24.3"
\score { \new PianoStaff <<
  \new Staff { \key g \major e'2\trill g'4\mordent a'4 }
  \new Staff { \clef bass c1 }
>> \layout {} \midi { \tempo 4 = 100 } }
'''}


def note(step, octave, duration, mark=""):
    notation = f"<notations><ornaments><{mark}/></ornaments></notations>" if mark else ""
    return (f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch>"
            f"<duration>{duration}</duration>{notation}</note>")


scores["trill.musicxml"] = (
    '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name>'
    '</score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions>'
    '<key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
    + note("E", 4, 2, "trill-mark") + note("G", 4, 1, "mordent") + note("A", 4, 1)
    + "<backup><duration>4</duration></backup>" + note("C", 3, 4) + "</measure></part></score-partwise>"
)


mozart = Path("catalog/seed/files/mozart/mozart_sonata_k545_1.ly")
goldberg = Path("catalog/seed/files/bach/bach_goldberg_aria_BWV988.ly")
if args.goldberg_only:
    scores = {goldberg.name: goldberg.read_text()}
elif not args.quick:
    scores[mozart.name] = mozart.read_text()
    scores[goldberg.name] = goldberg.read_text()


def timed_pitches(path):
    midi = mido.MidiFile(path)
    tick = 0
    for msg in mido.merge_tracks(midi.tracks):
        tick += msg.time
        if msg.type == "note_on" and msg.velocity:
            yield tick / (4 * midi.ticks_per_beat), msg.note


def mozart_trills(path, original):
    # Anchor to the original score. Expressive versions can move these bars by seconds.
    result = {}
    for bar, pitch in [(24, 81), (69, 74)]:
        pair = (pitch, pitch + 2)
        score = [(t, n) for t, n in timed_pitches(original) if n in pair]
        played = [n for _, n in timed_pitches(path) if n in pair]
        assert len(score) == len(played), path
        indices = [i for i, (time, _) in enumerate(score) if bar + 0.1 < time < bar + 0.8]
        result[bar + 1] = [played[i] for i in indices]
        assert result[bar + 1] == [score[i][1] for i in indices], path
        ending = [n for t, n in timed_pitches(original) if bar + 0.90 < t < bar + 0.94 and n >= pitch - 2]
        assert ending == [pitch - 2, pitch], (bar, ending)
    return result

def pitches(path):
    return [msg.note for msg in mido.MidiFile(path) if msg.type == "note_on" and msg.velocity]


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    context = browser.new_context(locale="zh-CN", accept_downloads=True)
    report = {}
    for filename, data in scores.items():
        path = args.output / filename
        path.write_text(data)
        page = context.new_page()
        page.goto(args.url.rstrip("/") + "/#editor")
        page.locator("#fileInput").set_input_files(path)
        if filename.endswith(".ly"):
            page.wait_for_function("code => document.querySelector('#lyEditor')?.value === code", arg=data)
        else:
            page.locator("#importedScoreCard").wait_for()
        page.locator("#performanceModel").select_option("virtuosonet" if filename in (mozart.name, goldberg.name) else "pianist")
        page.locator("#renderBtn").click()
        page.wait_for_function("location.hash === '#studio' || document.querySelector('#errBox')", timeout=900000)
        assert page.url.endswith("#studio"), page.locator("#errBox").inner_text()
        for variant in ["原谱演奏", "AI 演绎", "琶音还原版"]:
            page.get_by_role("button", name=variant, exact=True).click()
            with page.expect_download() as dl:
                page.locator("#dlMidiBtn").click()
            midi_path = args.output / f"{filename}-{variant}.mid"
            dl.value.save_as(midi_path)
            if filename == mozart.name:
                report[midi_path.name] = mozart_trills(midi_path, args.output / f"{filename}-原谱演奏.mid")
            elif filename == goldberg.name:
                # G5, G5, dotted A5 with prallmordent, written B5. Other voices are lower.
                report[midi_path.name] = [n for n in pitches(midi_path) if n >= 79][:9]
                if variant == "原谱演奏":
                    melody = [(t, n) for t, n in timed_pitches(midi_path) if n >= 79 and t < 0.75]
                    assert melody[-1] == (0.6875, 83), melody
            else:
                report[midi_path.name] = pitches(midi_path)
        page.close()
    browser.close()
(args.output / "note-ons.json").write_text(json.dumps(report, indent=2))
for name, sequence in report.items():
    if name.startswith(goldberg.name):
        assert sequence == [79, 79, 83, 81, 83, 81, 79, 81, 83], (name, sequence)
        continue
    if name.startswith(mozart.name):
        for hits in sequence.values():
            assert len(hits) >= 5 and all(a != b for a, b in zip(hits, hits[1:])), (name, hits)
        continue
    melody = [n for n in sequence if n != 48]
    assert sequence.count(48) == 1, (name, sequence)
    assert melody[-4:] == [67, 66, 67, 69], (name, sequence)
    trill = melody[:-4]
    assert len(trill) >= 4 and all(n == [64, 66][i % 2] for i, n in enumerate(trill)), (name, sequence)
print(f"Verified {len(report)} exported MIDIs in {args.output}")
