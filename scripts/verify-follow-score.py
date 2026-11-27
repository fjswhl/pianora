"""Verify native follow-score rendering through the studio. Run against a local build
with the audio/model assets installed. PIANORA_URL, PIANORA_BROWSER and
PIANORA_ARTIFACTS work as in verify-studio.py.
"""
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
artifacts = Path(os.getenv("PIANORA_ARTIFACTS", root / "artifacts"))
artifacts.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chrome"))
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.goto(os.getenv("PIANORA_URL", "http://127.0.0.1:4173") + "/#editor")
    page.locator("#presetSelect").select_option("mozart_sonata_k331_tema")
    page.locator("summary").first.click()
    page.locator("#cfmSteps").fill("4")
    page.locator("#batchCount").select_option("2")
    page.locator("#renderBtn").click()
    page.wait_for_function("location.hash === '#studio' || document.querySelector('#errBox')", timeout=240000)
    assert page.url.endswith("#studio"), page.locator("#errBox").inner_text()
    systems = page.locator(".follow-system")
    mark = page.locator(".follow-highlight")
    rail = page.locator(".follow-progress")
    seek = page.locator("#seekSlider")

    def seek_to(seconds):
        seek.fill(format(round(seconds, 1), "g"))

    def check_score_above_piano():
        player = page.locator(".roll-card")
        score = player.get_by_role("group", name="随奏谱")
        expect(score).to_be_visible()
        staff = score.bounding_box()
        keys = player.locator("#pianoCanvas").bounding_box()
        assert 0 <= keys["y"] - (staff["y"] + staff["height"]) <= 20

    expect(systems).to_have_count(3, timeout=120000)
    expect(mark).to_have_attribute("data-bar", "1")
    expect(page.locator("#pianoCanvas")).to_be_visible()
    expect(page.locator(".mixer-field small")).to_contain_text("就绪", timeout=120000)
    page.get_by_role("button", name="原谱演奏", exact=True).click()

    # The score has 8 + 10 written bars, each section played twice at eighth=112.
    bar_seconds = 6 * 60 / 112
    for played, printed in [(9, 1), (17, 9), (27, 9), (36, 18), (3, 3)]:
        seek_to((played - 1 + 0.2) * bar_seconds)
        expect(mark).to_have_attribute("data-bar", str(printed))
        expect(systems).to_have_count(3)
        if played == 36:
            expect(systems.last).to_have_attribute("data-row", "4")
    seek_to(bar_seconds * 3 - 0.28)
    page.locator("#playBtn").click()
    expect(mark).to_have_attribute("data-bar", "4")
    width = float(rail.get_attribute("width") or 0)
    page.wait_for_function("w => Number(document.querySelector('.follow-progress').getAttribute('width')) > w + 0.2", arg=width)
    page.locator("#playBtn").click()
    expect(page.locator("#playBtn")).to_have_text("播放")
    page.evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))")
    paused = rail.get_attribute("width")
    page.wait_for_timeout(300)
    assert rail.get_attribute("width") == paused
    page.locator("#stopBtn").click()
    expect(mark).to_have_attribute("data-bar", "1")
    for track in ["AI 演绎", "琶音还原版"]:
        page.get_by_role("button", name=track, exact=True).click()
        page.locator("#takesBar").select_option(index=1)
        seek.press("End")
        expect(mark).to_have_attribute("data-bar", "18")
        expect(systems).to_have_count(3)
    page.get_by_role("button", name="原谱演奏", exact=True).click()
    seek_to(bar_seconds * 18.4)
    expect(mark).to_have_attribute("data-bar", "11")
    check_score_above_piano()
    page.locator(".roll-card").screenshot(path=artifacts / "follow-score.png")
    page.set_viewport_size({"width": 390, "height": 844})
    expect(systems).to_have_count(3)
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
    page.emulate_media(reduced_motion="reduce")
    expect(rail).to_be_hidden()
    check_score_above_piano()
    page.locator(".roll-card").screenshot(path=artifacts / "follow-score-mobile.png")
    page.get_by_role("button", name="查看谱面").click()
    expect(page.locator(".svg-sheet-page svg").first).to_be_visible()
    page.get_by_role("button", name="试听与导出").click()
    expect(mark).to_have_attribute("data-bar", "11")

    # A short custom score exercises browser engraving and avoids padding blank rows.
    page.get_by_role("link", name="乐谱编辑").click()
    page.locator("#lyEditor").fill((root / "public/presets/short_etude.ly").read_text() + "\n% follow score E2E")
    page.locator("#renderBtn").click()
    page.wait_for_function("location.hash === '#studio' || document.querySelector('#errBox')", timeout=180000)
    assert page.url.endswith("#studio"), page.locator("#errBox").inner_text()
    expect(systems).to_have_count(1, timeout=120000)
    expect(mark).to_have_attribute("data-bar", "1")
    seek.press("End")
    expect(mark).to_have_attribute("data-bar", "4")

    page.locator(".cue-chip").first.click()
    expect(page.locator("#playBtn")).to_have_text("暂停")
    expect(mark).to_have_attribute("data-bar", "3", timeout=6000)
    page.locator("#stopBtn").click()

    # Each bar has one identifiable attack. Use the exported performance MIDI as
    # an independent clock, including all three passes and both alternative endings.
    page.get_by_role("link", name="乐谱编辑").click()
    page.locator("#lyEditor").fill(r"""
\version "2.24.3"
theme = \absolute {
  \time 4/4 \tempo 4=100
  \repeat volta 3 { c'1 \break d'1 \pageBreak }
  \alternative { \volta 1,2 { e'1 \break } \volta 3 { f'1 \break } }
  g'1
}
\score { \new Staff \theme \layout {} }
\score { \new Staff \unfoldRepeats \theme \midi {} }
""")
    page.locator("#renderBtn").click()
    page.wait_for_function("location.hash === '#studio' || document.querySelector('#errBox')", timeout=180000)
    assert page.url.endswith("#studio"), page.locator("#errBox").inner_text()
    expect(systems).to_have_count(3, timeout=120000)
    for track in ["AI 演绎", "琶音还原版"]:
        page.get_by_role("button", name=track, exact=True).click()
        with page.expect_download() as download:
            page.locator("#dlMidiBtn").click()
        decode = """const fs = require('node:fs'), {Midi} = require('@tonejs/midi');
          const midi = new Midi(fs.readFileSync(process.argv[1]));
          console.log(JSON.stringify(midi.tracks[0].notes.map(n => [n.midi, n.time])));"""
        notes = json.loads(subprocess.check_output(
            ["node", "-e", decode, str(download.value.path())], cwd=root))
        assert [pitch for pitch, time in notes] == [60, 62, 64, 60, 62, 64, 60, 62, 65, 67]
        rows = {60: 1, 62: 2, 64: 3, 65: 4, 67: 5}
        for i, (pitch, onset) in enumerate(notes):
            if i:
                seek_to(onset - 0.16)
                expect(mark.locator("..")).to_have_attribute("data-row", str(rows[notes[i - 1][0]]))
            seek_to(onset + 0.16)
            expect(mark.locator("..")).to_have_attribute("data-row", str(rows[pitch]))
            expect(systems).to_have_count(3)
    browser.close()
print("Follow-score E2E passed. Screenshots in", artifacts)
