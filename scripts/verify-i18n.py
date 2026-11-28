"""Run against npm run preview with local runtime assets and Python Playwright installed."""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
out = Path(os.getenv("PIANORA_ARTIFACTS", root / "artifacts"))
out.mkdir(parents=True, exist_ok=True)
base = os.getenv("PIANORA_URL", "http://127.0.0.1:4173")
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chromium"))
    page = browser.new_page(viewport={"width": 390, "height": 844})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base)
    language = page.locator(".locale-select")
    expect(page.get_by_role("heading", name="曲谱馆")).to_be_visible()
    page.get_by_role("tab", name="林俊杰").click()
    language.select_option("en")
    expect(page.locator("html")).to_have_attribute("lang", "en")
    expect(page.get_by_role("tab", name="JJ Lin")).to_have_attribute("aria-selected", "true")
    expect(page.get_by_role("heading", name="Practice Love")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=out / "i18n-en-mobile.png")
    page.reload()
    expect(page.get_by_role("heading", name="Score Library")).to_be_visible()
    page.locator('input[type="file"]').set_input_files({
        "name": "invalid.musicxml", "mimeType": "application/xml", "buffer": b"<broken"
    })
    expect(page.get_by_role("alert")).to_contain_text("Couldn’t parse MusicXML")
    language.select_option("zh-CN")
    expect(page.get_by_role("alert")).to_contain_text("MusicXML 文件解析失败")
    language.select_option("en")
    page.get_by_role("button", name="Open score", exact=True).click()
    source = page.locator("#lyEditor")
    expect(source).not_to_have_value("")
    edited = source.input_value() + "\n% 保留原文 / keep source\n"
    source.fill(edited)
    language.select_option("zh-CN")
    expect(source).to_have_value(edited)
    expect(page.get_by_role("heading", name="乐谱编辑")).to_be_visible()
    page.locator("#renderBtn").click()
    page.wait_for_url("**/#studio", timeout=240000)
    language.select_option("en")
    expect(page.get_by_role("button", name="Shape performance")).to_be_visible()
    expect(page.locator("#takesBar option:checked")).to_contain_text("Take #1")
    expect(page.locator(".mixer-field small")).to_contain_text("ready", timeout=120000)
    page.get_by_role("button", name="View score").click()
    expect(page.locator(".svg-sheet-page svg").first).to_be_visible(timeout=120000)
    page.get_by_role("button", name="Arpeggio details").click()
    expect(page.get_by_role("columnheader", name="Chord notes")).to_be_visible()
    page.get_by_role("button", name="Shape performance").click()
    page.locator('[data-mode="m6"]').click()
    expect(page.locator("#liveStatus")).to_contain_text("Ready")
    language.select_option("zh-CN")
    expect(page.locator("#liveStatus")).to_contain_text("就绪")
    expect(page.locator('[data-mode="m6"]')).to_contain_text("实时指挥")
    page.set_viewport_size({"width": 1280, "height": 840})
    page.screenshot(path=out / "i18n-zh-studio.png")
    assert not errors, errors
    report = {"default": "zh-CN", "persistedAfterReload": "en", "mobileWidth": 390,
              "importErrorTranslated": True, "sheetRendered": True, "filterPreserved": True, "sourcePreserved": True, "generatedTakeTranslated": True,
              "liveStatusTranslated": True, "pageErrors": errors}
    (out / "i18n.json").write_text(json.dumps(report, indent=2) + "\n")
    browser.close()
