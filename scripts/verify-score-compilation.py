"""Verify browser compilation, engraving and reuse through a production build in Chrome.
Uses the same PIANORA_* environment settings as verify-studio.py.
"""
import hashlib
import json
import os
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
        source = (root / "catalog/seed/files" / (piece + ".ly")).read_text()
        expect(page.locator("#lyEditor")).to_have_value(source)
        assert page.evaluate("scoreJobs.length") == 0
        results = {"first": generate(page)}
        assert results["first"]["method"] == "浏览器编译"
        assert page.evaluate("scoreJobs[0].format") == "midi"
        assert not any(".score-" in asset or ".pages-" in asset for asset in assets)
        midi = bytes(page.evaluate("""() => {
            const files = scoreJobs[0].files;
            return Array.from(files[Object.keys(files).find(k => k.endsWith('.midi') || k.endsWith('.mid'))]);
        }"""))
        assert midi.startswith(b"MThd")
        results["midiSha256"] = digest(midi)
        if piece == "short_etude":
            show_sheet(page)
            assert page.evaluate("scoreJobs.map(j => j.format)") == ["midi", "svg"]
            page.get_by_role("link", name="乐谱编辑").click()
            page.locator("summary").first.click()
            page.locator("#seed").fill("123")
            results["changedSeed"] = generate(page)
            assert results["changedSeed"]["method"] == "复用上次结果"
            show_sheet(page)
            assert page.evaluate("scoreJobs.length") == 2
            page.get_by_role("link", name="乐谱编辑").click()
            page.locator("#lyEditor").fill(source + "\n% edited")
            assert generate(page)["method"] == "浏览器编译"
            assert page.evaluate("scoreJobs[2].format") == "midi"
        report[piece] = results
        page.close()
    browser.close()

output.mkdir(parents=True, exist_ok=True)
(output / "score-compilation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False))
