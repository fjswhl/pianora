"""Compare prepared, edited and repeated scores through a production build in Chrome.
Uses the same PIANORA_* environment settings as verify-studio.py.
"""
import base64
import hashlib
import json
import os
import re
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
url = os.getenv("PIANORA_URL", "http://127.0.0.1:4173")
output = Path(os.getenv("PIANORA_ARTIFACTS", root / "artifacts"))
ready = "pianora:score-ready"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def generate(page):
    count = page.evaluate("n => performance.getEntriesByName(n).length", ready)
    page.locator("#renderBtn").click()
    page.wait_for_function("([n,c]) => performance.getEntriesByName(n).length > c || document.querySelector('#errBox')",
                           arg=[ready, count], timeout=180000)
    assert not page.locator("#errBox").count(), page.locator("#errBox").inner_text()
    return page.evaluate("""n => {
        const e = performance.getEntriesByName(n).at(-1);
        return {method: e.detail.method, scoreReadyMs: Math.round(e.duration * 10) / 10};
    }""", ready)


def show_sheet(page):
    page.wait_for_url("**/#studio", timeout=180000)
    page.get_by_role("button", name="查看谱面").click()
    expect(page.locator(".svg-sheet-page svg").first).to_be_visible(timeout=180000)


observer = """window.scoreJobs = [];
          window.Worker = class extends Worker {
            constructor(...args) { super(...args); this.addEventListener('message', ({data}) => {
              if (data.type === 'result' && this.scoreFormat) {
                window.scoreJobs.push({format:this.scoreFormat, files:data.files});
              }
            }); }
            postMessage(message, ...args) {
              if (message?.source) this.scoreFormat = message.format;
              return super.postMessage(message, ...args);
            }
          };"""

report = {}
with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chrome"))
    for piece in ["short_etude", "clair_de_lune"]:
        page = browser.new_page()
        # Observe actual compiler messages without changing inputs or results.
        page.add_init_script(observer)
        assets = []
        page.on("request", lambda r: assets.append(r.url))
        page.goto(url + "/#editor")
        page.locator("#presetSelect").select_option(piece)
        source = (root / "public/presets" / (piece + ".ly")).read_text()
        expect(page.locator("#lyEditor")).to_have_value(source)
        prepared = generate(page)
        assert prepared["method"] == "读取预编译谱", prepared
        assert not any("runtime.data-" in a or "lilypond-" in a for a in assets)
        assert page.evaluate("""() => {
            const ready = performance.getEntriesByName('pianora:score-ready').at(-1);
            return performance.getEntriesByType('resource').filter(r => r.name.includes('.pages-'))
              .every(r => r.startTime >= ready.startTime + ready.duration);
        }""")
        asset = next(a for a in assets if re.search(r"\.score-[^/]+\.json", a))
        reference = page.request.get(asset).json()
        results = {"preset": prepared}
        if piece == "short_etude":
            show_sheet(page)
            pages_url = next(a for a in assets if ".pages-" in a)
            reference_pages = page.request.get(pages_url).json()
            page.get_by_role("link", name="乐谱编辑").click()
            page.locator("summary").first.click()
            page.locator("#seed").fill("123")
            results["changedSeed"] = generate(page)
            assert results["changedSeed"]["method"] == "复用上次结果"
            page.wait_for_url("**/#studio", timeout=180000)
            page.get_by_role("link", name="乐谱编辑").click()
        else:
            # A fresh editor also avoids waiting for the full long-score AI run.
            page.close()
            page = browser.new_page()
            page.add_init_script(observer)
            page.goto(url + "/#editor")
        page.locator("#lyEditor").fill(source + "\n% same music, different source")
        edited = generate(page)
        assert edited["method"] == "浏览器编译"
        results["edited"] = edited
        if piece == "clair_de_lune":
            page.wait_for_function("performance.getEntriesByType('resource').some(r => new URL(r.name).pathname.endsWith('.onnx'))", timeout=120000)
            assert page.evaluate("""() => {
                const compile = performance.getEntriesByName('pianora:score-compile').at(-1);
                const model = performance.getEntriesByType('resource').find(r => new URL(r.name).pathname.endsWith('.onnx'));
                return compile.startTime < model.responseEnd && model.startTime < compile.startTime + compile.duration;
            }""")
        if piece == "short_etude":
            page.wait_for_url("**/#studio", timeout=180000)
        # Opening the studio now starts engraving for the follow-score panel.
        assert page.evaluate("scoreJobs.map(j=>j.format)") in (["midi"], ["midi", "svg"])
        files = page.evaluate("""() => {
            const f = scoreJobs[0].files;
            return {midi:Array.from(f[Object.keys(f).find(k=>/\\.midi?$/.test(k))]),
                    annotations:JSON.parse(new TextDecoder().decode(f['annotations.json']))};
        }""")
        assert bytes(files["midi"]) == base64.b64decode(reference["midi"])
        assert files["annotations"] == reference["rawAnnotations"]
        results["verified"] = {"identicalMidiSha256": digest(bytes(files["midi"])), "annotations": len(files["annotations"])}
        if piece == "short_etude":
            page.get_by_role("link", name="乐谱编辑").click()
            results["editedRepeat"] = generate(page)
            assert results["editedRepeat"]["method"] == "复用上次结果"
            page.wait_for_url("**/#studio", timeout=180000)
            page.get_by_role("link", name="乐谱编辑").click()
            page.locator("#lyEditor").fill("unfinished draft")
            page.get_by_role("link", name="演奏室").click()
            show_sheet(page)
            assert page.evaluate("scoreJobs.map(j=>j.format)") == ["midi", "svg"]
            rendered = page.evaluate("""() => Object.entries(scoreJobs[1].files)
                .filter(([k])=>k.endsWith('.svg')).map(([,v])=>new TextDecoder().decode(v))""")
            assert rendered == reference_pages
            results["verified"]["identicalSvgPages"] = len(rendered)
            page.get_by_role("link", name="乐谱编辑").click()
            page.route("**/*.score-*.json", lambda route: route.abort(), times=1)
            page.locator("#presetSelect").select_option(piece)
            assert generate(page)["method"] == "浏览器编译"
            results["verified"]["unavailableAssetFallback"] = True
        report[piece] = results
        page.close()
    browser.close()

output.mkdir(parents=True, exist_ok=True)
(output / "score-compilation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False))
