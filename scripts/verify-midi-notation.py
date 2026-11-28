"""Run against npm run preview with uv run --with playwright scripts/verify-midi-notation.py."""
import json
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
base = os.getenv("PIANORA_URL", "http://127.0.0.1:4173")
output = Path(os.getenv("PIANORA_ARTIFACTS", root / "artifacts"))
output.mkdir(parents=True, exist_ok=True)
report = {}
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chrome"))
    for song, preset in [("晴天", "sunny_day"), ("修炼爱情", None)]:
        page = browser.new_page()
        page.goto(base + "/#editor")
        if preset:
            page.locator("#presetSelect").select_option(preset)
        else:
            page.locator("#fileInput").set_input_files(root / "catalog/seed/files/mandopop" / (song + ".mid"))
        expect(page.locator("#importedScoreCard")).to_contain_text(song)
        page.locator("#renderBtn").click()
        page.wait_for_url("**/#studio", timeout=240000)
        expect(page.get_by_role("button", name="显示 MIDI 随奏谱")).to_be_visible()
        assert not page.evaluate("performance.getEntriesByType('resource').some(e => e.name.includes('/MidiToMusicXML-'))")
        if not preset:
            page.get_by_role("button", name="显示 MIDI 随奏谱").click()
            expect(page.locator(".follow-system").first).to_be_visible(timeout=90000)
        page.get_by_role("button", name="查看谱面").click()
        pages = page.locator(".svg-sheet-page svg:not(.harmony-overlay)")
        expect(pages.first).to_be_visible(timeout=90000)
        assert pages.first.locator("path").count() > 10
        report[song] = {"pages": pages.count(), "entry": "preset" if preset else "upload"}
        if preset:
            page.locator("#svgGallery").screenshot(path=output / "midi-notation.png")
        page.get_by_role("button", name="试听与导出").click()
        expect(page.locator(".follow-system").first).to_be_visible(timeout=90000)
        expect(page.locator(".mixer-field small")).to_contain_text("就绪", timeout=120000)
        page.locator("#playBtn").click()
        expect(page.locator("#playBtn")).to_have_text("暂停")
        page.wait_for_function("Number(document.querySelector('.follow-highlight')?.dataset.bar) > 1", timeout=30000)
        page.locator("#stopBtn").click()
        page.close()
    browser.close()
(output / "midi-notation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(report)
