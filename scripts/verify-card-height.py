"""Check library card sizing across animation frames and responsive breakpoints."""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

output = Path(os.getenv("PIANORA_ARTIFACTS", Path(__file__).resolve().parents[1] / "artifacts"))
output.mkdir(parents=True, exist_ok=True)
report = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chrome"))
    for dpr in [1, 2, 3]:
        page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=dpr)
        page.goto(os.getenv("PIANORA_URL", "http://localhost:5173"))
        cards = page.locator(".score-card")
        expect(cards).to_have_count(35)
        for width in [390, 360, 844, 384]:
            page.set_viewport_size({"width": width, "height": 844})
            heights = cards.evaluate_all("""async cards => {
              await document.fonts.ready;
              const next = () => new Promise(requestAnimationFrame);
              await next(); await next();
              const sample = () => cards.map(c => c.getBoundingClientRect().height);
              const start = sample();
              for (let i = 0; i < 60; i++) {
                await next();
                if (sample().some((h,j) => Math.abs(h-start[j]) > .1))
                  throw new Error('Card height changed: '+start+' -> '+sample());
              }
              return start;
            }""")
            report.append({"width": width, "devicePixelRatio": dpr, "cardHeights": heights})
        target = cards.filter(has_text="Sonata KV 331")
        if dpr == 3:
            target.screenshot(path=output / "mobile-k331.png")
        target.click()
        expect(page.locator("#presetSelect")).to_have_value("mozart_sonata_k331_tema")
        page.close()
    browser.close()
(output / "card-layout.json").write_text(json.dumps(report, indent=2) + "\n")
