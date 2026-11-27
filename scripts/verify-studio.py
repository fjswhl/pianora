"""Run against npm run preview with the model, soundfont and runtimes installed.
Requires Python Playwright and Chromium. Writes PNG evidence under artifacts/.
"""
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
output = root / "artifacts"
output.mkdir(exist_ok=True)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chromium"))
    page = browser.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    page.goto(os.getenv("PIANORA_URL", "http://127.0.0.1:4173"))
    expect(page.locator(".score-card")).to_have_count(3)
    page.screenshot(path=output / "library.png")
    library_url = page.url
    page.close()
    page = browser.new_page(viewport={"width": 390, "height": 844}, accept_downloads=True)
    page.goto(library_url)
    expect(page.locator(".score-card")).to_have_count(3)
    expect(page.get_by_role("heading", name="精选曲谱")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=output / "mobile.png")
    page.locator(".score-card").nth(1).click()
    expect(page.locator("#lyEditor")).to_have_value(re.compile("Claude Debussy"))
    page.locator("summary").first.click()
    expect(page.locator("input[type=number]").first).to_be_visible()
    page.get_by_role("link", name="曲谱馆").click()
    with page.expect_file_chooser() as chooser:
        page.get_by_role("button", name="导入乐谱").click()
    chooser.value.set_files(root / "public/presets/rosee_dargent.ly")
    expect(page.locator("#presetSelect")).to_have_value("custom")
    page.get_by_role("link", name="曲谱馆").click()
    page.get_by_role("button", name="打开乐谱").click()
    page.set_viewport_size({"width": 1440, "height": 900})
    page.screenshot(path=output / "editor.png")
    page.locator("#renderBtn").click()
    page.wait_for_function("location.hash === '#studio' || !!document.querySelector('#errBox')", timeout=240000)
    assert page.url.endswith("#studio"), page.locator("#errBox").inner_text()
    page.locator("#playBtn").click()
    expect(page.locator("#playBtn")).to_have_text("暂停")
    page.locator("#stopBtn").click()
    with page.expect_download() as midi:
        page.locator("#dlMidiBtn").click()
    assert midi.value.path().read_bytes().startswith(b"MThd")
    for name in ["原谱演奏", "AI 演绎", "琶音还原版"]:
        track = page.get_by_role("button", name=name, exact=True)
        track.click()
        expect(track).to_have_attribute("aria-pressed", "true")
    page.locator("#reverbSlider").focus()
    page.keyboard.press("End")
    expect(page.get_by_text("65%", exact=True)).to_be_visible()
    page.screenshot(path=output / "studio.png", full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    expect(page.locator("#pianoCanvas")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=output / "studio-mobile.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    with page.expect_download(timeout=120000) as wav:
        page.locator("#exportWavBtn").click()
    assert wav.value.path().read_bytes()[:4] == b"RIFF"
    page.get_by_role("button", name="调整演绎", exact=True).click()
    page.get_by_role("button", name="分段指挥", exact=True).click()
    expect(page.locator("#m5RunBtn")).to_be_visible()
    page.get_by_role("button", name="查看谱面").click()
    expect(page.locator(".svg-sheet-page svg").first).to_be_visible()
    browser.close()
