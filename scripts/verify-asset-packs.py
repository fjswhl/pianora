"""Exercise idle downloads, foreground handoff, persistent reuse and recovery in Chrome.
Run against npm run preview or local Wrangler with the three default sources installed.
"""
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
base = os.getenv("PIANORA_URL", "http://127.0.0.1:4173")
output = Path(os.getenv("PIANORA_ARTIFACTS", root / "artifacts"))
output.mkdir(parents=True, exist_ok=True)
cache_name = "pianora-asset-packs-v1"
paths = ["/soundfonts/abbey_steinway_d.sf2", "/models/pianoflow_step_fp32.onnx",
         "/ort/ort-wasm-simd-threaded.jsep.wasm"]
report = {}


def generate(page):
    page.locator("#renderBtn").click()
    page.wait_for_function("location.hash === '#studio' || document.querySelector('#errBox')", timeout=180000)
    assert page.url.endswith("#studio"), page.locator("#errBox").inner_text()
    expect(page.locator(".mixer-field small")).to_contain_text("就绪", timeout=60000)
    page.locator("#playBtn").click()
    expect(page.locator("#playBtn")).to_have_text("暂停")
    page.locator("#stopBtn").click()


with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chrome"))
    context = browser.new_context()
    context.add_init_script("""window.modelProgress = [];
      new MutationObserver(() => {
        const msg = document.querySelector('#progressMsg')?.textContent;
        if (msg?.includes('PianoFlow 模型') && msg !== modelProgress.at(-1)) modelProgress.push(msg);
      }).observe(document, {subtree:true, childList:true, characterData:true});""")
    page = context.new_page()
    manifest = page.request.get(base + "/packs/manifest.json").json()
    count = sum(len(manifest[path]["parts"]) for path in paths)
    urls = []
    held = []
    page.on("request", lambda req: urls.append(urlsplit(req.url).path))
    page.route("**/packs/*.pack", lambda route: held.append(route), times=1)
    page.goto(base)
    expect(page.get_by_role("heading", name="精选曲谱")).to_be_visible()
    assert not any(u.startswith("/packs/") for u in urls)
    with page.expect_request("**/packs/*.pack", timeout=20000):
        pass
    while not held:
        page.wait_for_timeout(20)
    first = urlsplit(held[0].request.url).path
    page.get_by_role("button", name="打开乐谱").click()
    expect(page.locator("#renderBtn")).to_be_visible()
    held[0].continue_()
    generate(page)
    assert urls.count(first) == 1
    deadline = time.monotonic() + 120
    while page.evaluate("async name => (await (await caches.open(name)).keys()).length", cache_name) < count:
        assert time.monotonic() < deadline, "Default resource cache did not finish"
        page.wait_for_timeout(200)
    packed = [u for u in urls if u.startswith("/packs/") and u.endswith(".pack")]
    assert len(set(packed)) == len(packed) == count, (len(set(packed)), len(packed), count)
    assert not set(paths).intersection(urls), urls
    sizes = page.evaluate("""() => performance.getEntriesByType('resource')
        .filter(r => new URL(r.name).pathname.startsWith('/packs/') && r.name.endsWith('.pack'))
        .map(r => [new URL(r.name).pathname, r.encodedBodySize])""")
    assert len(sizes) == count and all(n > 0 for _, n in sizes)
    report["coldBytes"] = {path: {"raw": manifest[path]["size"], "packed": sum(n for u, n in sizes if Path(path).name in u)}
                           for path in paths}

    cold = page.evaluate("modelProgress")
    assert any("获取" in msg for msg in cold), cold
    # Reload the editor to destroy the in-memory model and synth on the same origin.
    page.get_by_role("link", name="乐谱编辑").click()
    forbidden = []
    def block(route):
        forbidden.append(route.request.url)
        route.abort()
    page.route("**/packs/*.pack", block)
    for path in paths:
        page.route("**" + path + "*", block)
    page.reload()
    generate(page)
    warm = page.evaluate("modelProgress")
    assert warm and all("本地缓存" in msg and "获取" not in msg for msg in warm), warm
    report["warmModelProgress"] = warm[-1]
    assert not forbidden, forbidden
    report["warmLargeAssetRequests"] = len(forbidden)

    # Corrupt one disk entry. Replace it only after a successful integrity check.
    page.close()
    page = context.new_page()
    page.goto(base)
    await_key = paths[1].split("/")[-1] + "-" + manifest[paths[1]]["parts"][0] + ".pack"
    key = "/packs/" + await_key
    page.evaluate("async ([name,key]) => (await caches.open(name)).put(key, new Response('damaged'))",
                  [cache_name, key])
    recovered = []
    page.on("request", lambda req: recovered.append(urlsplit(req.url).path))
    page.get_by_role("button", name="打开乐谱").click()
    expect(page.locator("#renderBtn")).to_be_visible()
    generate(page)
    assert [u for u in recovered if u.startswith("/packs/") and u.endswith(".pack")] == [key], recovered
    partial = page.evaluate("modelProgress")
    assert any("本地缓存" in msg and "获取 1 块" in msg for msg in partial), partial
    report["recoveredChunks"] = 1
    context.close()

    page = browser.new_page()
    page.add_init_script("Object.defineProperty(navigator.connection,'saveData',{get:()=>true})")
    attempts = []
    page.on("request", lambda req: attempts.append(urlsplit(req.url).path))
    page.goto(base)
    page.wait_for_timeout(5500)
    assert not any(u.startswith("/packs/") for u in attempts)
    page.route("**/packs/abbey_steinway_d.sf2-*.pack", lambda route: route.fulfill(status=503, body="unavailable"))
    page.get_by_role("button", name="打开乐谱").click()
    generate(page)
    assert paths[0] in attempts
    report["saveDataIdleRequests"] = 0
    report["rawFallbackPlayed"] = True
    browser.close()

(output / "asset-packs.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False))
