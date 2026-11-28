"""A/B the browser compiler on real scores through the editor and listening view.

Run against npm run preview with Playwright for Python and Chrome installed.
The reference pass omits Pianora's compiler settings. Both passes use the same
production app, source, WASM engine and rendering pipeline.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
url = os.getenv("PIANORA_URL", "http://127.0.0.1:4173")
output = Path(os.getenv("PIANORA_ARTIFACTS", root / "artifacts"))
scores = {
    "short_etude": "short_etude.ly",
    "clair_de_lune": "clair_de_lune.ly",
    "mozart_sonata_k331_tema": "mozart/mozart_sonata_k331_1_tema.ly",
}

observer = """
window.engravingJobs = {};
window.Worker = class extends Worker {
  constructor(...args) {
    super(...args);
    this.addEventListener('message', async ({data}) => {
      if (!this.job || data.type !== 'result') return;
      const {format, start} = this.job;
      const ms = Math.round(performance.now() - start);
      const files = {};
      for (const [name, bytes] of Object.entries(data.files)) {
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        files[name] = Array.from(hash, x => x.toString(16).padStart(2, '0')).join('');
      }
      window.engravingJobs[format] = {ms, files};
    });
  }
  postMessage(message, ...args) {
    if (message?.source) {
      this.job = {format: message.format, start: performance.now()};
      if (REFERENCE && message.includeSettings?.startsWith('pianora-')) {
        message = {...message, files: {...message.files}};
        delete message.files[message.includeSettings];
        delete message.includeSettings;
      }
    }
    return super.postMessage(message, ...args);
  }
};
"""


def run(browser, piece, reference):
    page = browser.new_page()
    try:
        page.add_init_script(observer.replace("REFERENCE", json.dumps(reference)))
        page.goto(url + "/#editor")
        page.locator("#presetSelect").select_option(piece)
        expect(page.locator("#lyEditor")).to_have_value((root / "catalog/seed/files" / scores[piece]).read_text())
        page.locator("summary").first.click()
        page.locator("#cfmSteps").fill("4")
        page.locator("#renderBtn").click()
        page.wait_for_function("""() => (engravingJobs.midi && engravingJobs.svg &&
          document.querySelector('.follow-system')) || document.querySelector('#errBox')""", timeout=240000)
        expect(page.locator("#errBox")).to_have_count(0)
        page.locator("#playBtn").click()
        expect(page.locator("#playBtn")).to_have_text("暂停", timeout=60000)
        page.locator("#playBtn").click()
        result = page.evaluate("engravingJobs")
        for job in result.values():
            assert any(name.endswith((".mid", ".midi")) for name in job["files"])
            assert "annotations.json" in job["files"]
        assert any(name.endswith(".svg") for name in result["svg"]["files"])
        return result
    finally:
        page.close()


report = {}
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chrome"))
    for piece in scores:
        reference = run(browser, piece, True)
        optimized = run(browser, piece, False)
        report[piece] = {}
        for stage in ("midi", "svg"):
            assert reference[stage]["files"] == optimized[stage]["files"], (piece, stage, reference[stage], optimized[stage])
            report[piece][stage] = {"referenceMs": reference[stage]["ms"], "optimizedMs": optimized[stage]["ms"],
                                    "sha256": optimized[stage]["files"]}
        print(piece, [(stage, data["referenceMs"], data["optimizedMs"]) for stage, data in report[piece].items()], flush=True)
    version = browser.version
    browser.close()

output.mkdir(parents=True, exist_ok=True)
(output / "browser-engraving.json").write_text(json.dumps({"browser": version, "scores": report}, indent=2) + "\n")
