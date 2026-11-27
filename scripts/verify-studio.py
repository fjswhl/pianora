"""Run against npm run preview with the model, soundfont and runtimes installed.
Requires Python Playwright and Chromium. Writes PNG evidence under artifacts/.
"""
import json
import os
import re
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
output = Path(os.getenv("PIANORA_ARTIFACTS", root / "artifacts"))
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chromium"))
    page = browser.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    page.goto(os.getenv("PIANORA_URL", "http://127.0.0.1:4173"))
    expect(page.locator(".score-card")).to_have_count(26)
    page.wait_for_load_state("networkidle")
    resources = page.evaluate("performance.getEntriesByType('resource').map(r => ({path: new URL(r.name).pathname, bytes: r.decodedBodySize}))")
    scripts = [r for r in resources if r["path"].endswith(".js") and r["path"].startswith("/assets/")]
    assert scripts and 0 < sum(r["bytes"] for r in scripts) < 1_227_482, scripts
    assert not any(r["path"].startswith(("/presets/", "/models/", "/ort/", "/soundfonts/")) for r in resources), resources
    page.screenshot(path=output / "library.png")
    library_url = page.url
    warm = None
    if os.getenv("PIANORA_VERIFY_EDGE"):
        page.goto("about:blank")
        page.goto(library_url, wait_until="networkidle")
        warm = page.evaluate("performance.getEntriesByType('resource').filter(r => new URL(r.name).pathname.startsWith('/assets/')).map(r => ({path: new URL(r.name).pathname, transferred: r.transferSize}))")
        assert warm and all(r["transferred"] == 0 for r in warm), warm
    page.close()
    page = browser.new_page(viewport={"width": 390, "height": 844}, accept_downloads=True)
    requests = []
    page.on("request", lambda r: requests.append((r.method, urlsplit(r.url).path)))
    page.goto(library_url)
    expect(page.locator(".score-card")).to_have_count(26)
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
    generation_start = page.evaluate("performance.now()")
    page.locator("#renderBtn").click()
    page.wait_for_function("location.hash === '#studio' || !!document.querySelector('#errBox')", timeout=240000)
    assert page.url.endswith("#studio"), page.locator("#errBox").inner_text()
    expect(page.locator(".mixer-field small")).to_contain_text("就绪", timeout=120000)
    page.locator("#playBtn").click()
    expect(page.locator("#playBtn")).to_have_text("暂停")
    elapsed = page.evaluate("performance.now()") - generation_start
    timing = page.evaluate("""() => {
      const compile = performance.getEntriesByName('pianora:score-compile').at(-1);
      const model = performance.getEntriesByName('pianora:model-bytes').at(-1);
      return {compileStart: compile.startTime, compileEnd: compile.startTime + compile.duration,
              modelStart: model.startTime, modelEnd: model.startTime + model.duration};
    }""")
    assert page.evaluate("performance.getEntriesByName('pianora:score-ready').at(-1).detail.method") == "浏览器编译"
    assert not any(".score-" in path or ".pages-" in path for _, path in requests)
    assert any("lilypond" in path for _, path in requests)
    soundfont_requests = [m for m, path in requests if path.endswith(".sf2")]
    sf_parts = [path for _, path in requests if path.startswith("/packs/abbey_steinway_d.sf2-")]
    assert (soundfont_requests == ["GET"] or (sf_parts and not soundfont_requests)), requests
    assert len(sf_parts) == len(set(sf_parts)), sf_parts
    assert [path for m, path in requests if path.endswith(".ly")] == ["/presets/clair_de_lune.ly", "/presets/short_etude.ly"]
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
    # Open a fresh editor directly, retry a failed lazy fetch, then supersede a
    # delayed selection. Its late response must never replace the current score.
    editor = browser.new_page()
    editor.goto(library_url + "#editor")
    expect(editor.locator("#lyEditor")).to_have_value(re.compile("Lune Miniature"))
    preset = editor.locator("#presetSelect")
    source_url = "**/presets/rosee_dargent.ly"
    editor.route(source_url, lambda route: route.fulfill(status=503, body="Unavailable"), times=1)
    preset.select_option("rosee_dargent")
    expect(editor.get_by_role("alert")).to_contain_text("曲谱加载失败")
    expect(editor.locator("#renderBtn")).to_be_disabled()
    held = []
    editor.route(source_url, lambda route: held.append(route), times=1)
    with editor.expect_request(source_url):
        preset.select_option("rosee_dargent")
    preset.select_option("short_etude")
    held[0].continue_()
    editor.wait_for_load_state("networkidle")
    expect(editor.locator("#lyEditor")).to_have_value(re.compile("Lune Miniature"))
    preset.select_option("rosee_dargent")
    expect(editor.locator("#lyEditor")).to_have_value(re.compile("Rosée d'Argent"))
    for score_id, filename in [
        ("mozart_fantasia_k397", "mozart_fantasia_k397_Dm.ly"),
        ("mozart_sonata_k331_tema", "mozart_sonata_k331_1_tema.ly"),
        ("mozart_sonata_k545_1", "mozart_sonata_k545_1.ly"),
        ("mozart_sonata_k545_2", "mozart_sonata_k545_2.ly"),
    ]:
        preset.select_option(score_id)
        expect(editor.locator("#lyEditor")).to_have_value((root / "public/presets/mozart" / filename).read_text())
    editor.close()
    report = {"homepageAssets": resources, "generationToPlayMs": round(elapsed),
              "pipelineMs": timing, "soundfontRequests": soundfont_requests,
              "verified": ["MIDI", "WAV", "score SVG", "track selection", "mobile layout", "direct editor entry", "preset retry and late response"]}
    if os.getenv("PIANORA_VERIFY_EDGE"):
        asset = urljoin(library_url, scripts[0]["path"])
        assert "immutable" in page.request.head(asset).headers["cache-control"]
        assert "must-revalidate" in page.request.head(library_url).headers["cache-control"]
        release = json.loads((root / "src/engine/assetSources.json").read_text())["model"]
        model_url = urljoin(library_url, release["path"]) + "?rev=" + release["revision"]
        # Packed clients bypass the raw model. Prime its legacy range cache explicitly.
        assert page.request.get(model_url).status == 200
        partial = page.request.get(model_url, headers={"Range": "bytes=0-7"})
        assert partial.status == 206 and len(partial.body()) == 8
        assert partial.headers["x-pianora-cache"] == "HIT"
        etag = partial.headers["etag"]
        assert page.request.head(model_url, headers={"If-None-Match": etag}).status == 304
        assert page.request.head(model_url.split("?")[0]).status == 200
        assert page.request.head(model_url.split("?")[0] + "?rev=" + "0"*32).status == 404
        report["edge"] = {"warmAssets": warm, "range": partial.headers["content-range"], "cache": "HIT",
                          "conditional": 304, "wrongRevision": 404, "legacy": 200}
    (output / "loading-performance.json").write_text(json.dumps(report, indent=2) + "\n")
    browser.close()
