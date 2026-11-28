"""Run from the repo root after npm run build. Use --playback with the local runtime and packs restored."""
import argparse
import functools
import hashlib
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import time
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--output", required=True, type=Path)
parser.add_argument("--playback", action="store_true")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
score = json.loads(Path("catalog/seed/manifest.json").read_text())["scores"][0]
source = (Path("catalog/seed/files") / score["file"]).read_bytes()
score["url"] = "/api/catalog/files/" + hashlib.sha256(source).hexdigest() + ".ly"
score["number"] = 1
revision = 0
down = False
worker = Path("dist/sw.js").read_text()
first_line, code = worker.split("\n", 1)
build = json.loads(first_line.removeprefix("const BUILD = ").removesuffix(";"))
private = ["/api/account/options", "/api/library", "/p/" + "a" * 32 + "/performance"]


class Site(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def body(self, data, mime, status=200):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlsplit(self.path).path
        if down:
            return self.body(b"network unavailable", "text/plain", 503)
        html = build["html"].replace("</head>", f'<meta name="qa-release" content="{revision}"></head>')
        if path in ("/", "/index.html"):
            return self.body(html.encode(), "text/html; charset=utf-8")
        if path == "/sw.js":
            cfg = dict(build, html=html)
            if revision > 1:
                cfg.update(assets=build["assets"] + ["/assets/test-release.css"],
                           core=build["core"] + ["/assets/test-release.css"])
            script = code
            if revision == 0:
                # Previously deployed worker always served the embedded document.
                script = """self.addEventListener('activate', e=>e.waitUntil(self.clients.claim()));
                    self.addEventListener('fetch', e=>{if(e.request.mode==='navigate')
                    e.respondWith(new Response(BUILD.html,{headers:{'Content-Type':'text/html; charset=utf-8'}}))})"""
            return self.body(("const BUILD = " + json.dumps(cfg) + ";\n" + script).encode(), "text/javascript")
        if path == "/assets/test-release.css":
            return self.body(b"body{}", "text/css", 503 if revision == 2 else 200)
        if path.startswith("/assets/") and self.headers.get("Range"):
            self.send_response(206)
            self.send_header("Content-Range", "bytes 0-0/100")
            self.end_headers()
            self.wfile.write(b"x")
            return
        if self.headers.get("Authorization"):
            return self.body(b"authorized-network-response", "text/plain")
        if path == score["url"]:
            return self.body(source, "text/plain")
        metadata = {"/api/catalog/composers": {"items": [{"composer":"Pianora","pieces":1}], "total":1,"next":None},
                    "/api/catalog/scores": {"items":[score],"next":None},
                    "/api/catalog/scores/short_etude": score}
        if path in metadata:
            return self.body(json.dumps(metadata[path]).encode(), "application/json")
        if path in private:
            return self.body(b'{"publishableKey":null}', "application/json")
        super().do_GET()


def digest(page):
    with page.expect_download() as download:
        page.locator("#dlMidiBtn").click()
    return hashlib.sha256(Path(download.value.path()).read_bytes()).hexdigest()


server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Site, directory="dist"))
threading.Thread(target=server.serve_forever,daemon=True).start()
origin = "http://127.0.0.1:" + str(server.server_port)
report = {}
with TemporaryDirectory() as profile, sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(profile,channel=os.environ.get("PIANORA_BROWSER","chromium"),locale="zh-CN",accept_downloads=True)
    page = ctx.new_page()
    page.goto(origin + "/#library")
    page.wait_for_function("!!navigator.serviceWorker.controller")
    release = 'meta[name="qa-release"]'
    other = ctx.new_page()
    other.goto(origin + "/#editor")
    expect(other.locator(release)).to_have_attribute("content", "0")
    revision = 1
    page.reload(wait_until="commit")
    expect(page.locator(release)).to_have_attribute("content", "1", timeout=45000)
    assert page.url.endswith("/#library") and not other.is_closed()
    other.close()
    report["legacyUpgradeOnSingleRefresh"] = True
    manifest = page.evaluate("fetch('/manifest.webmanifest').then(r=>r.json())")
    assert manifest["display"] == "standalone" and manifest["start_url"] == "/"
    errors = ctx.new_cdp_session(page).send("Page.getInstallabilityErrors")["installabilityErrors"]
    assert not errors, errors
    report["installabilityErrors"] = errors
    for icon in manifest["icons"]:
        size = page.evaluate("""async src=>{const image=new Image();image.src=src;await image.decode();
                              return image.naturalWidth+'x'+image.naturalHeight}""", icon["src"])
        assert size == icon["sizes"]

    keys = "() => caches.open('pianora-pwa-static-v1').then(async c=>(await c.keys()).map(k=>new URL(k.url).pathname))"
    shell = page.evaluate(keys)
    assert all(p in shell for p in build["core"])
    assert not any(p.endswith((".pack",".wasm",".onnx",".bin")) for p in shell)
    report["installBytesUncompressed"] = sum(Path("dist"+p).stat().st_size for p in build["core"])
    assert report["installBytesUncompressed"] < 1024 * 1024
    css = next(path for path in build["core"] if path.endswith(".css"))
    # Bypass the separate HTTP cache to observe whether the service worker forwards each request.
    assert page.evaluate("p=>fetch(p,{cache:'no-store',headers:{Range:'bytes=0-0'}}).then(r=>r.status)",css) == 206
    assert page.evaluate("p=>fetch(p,{cache:'no-store',headers:{Authorization:'fixture'}}).then(r=>r.text())",css) == "authorized-network-response"
    expect(page.locator(".score-card").first).to_be_visible()
    page.locator(".score-card").first.click()
    expect(page.locator("#lyEditor")).to_have_value(source.decode())
    for path in private:
        page.evaluate("path=>fetch(path).then(r=>r.text())",path)
    all_keys = """async()=> (await Promise.all((await caches.keys()).filter(k=>k.startsWith('pianora-pwa-'))
      .map(async k=>(await (await caches.open(k)).keys()).map(r=>new URL(r.url).pathname)))).flat()"""
    assert not set(private).intersection(page.evaluate(all_keys))
    if args.playback:
        page.locator("#performanceModel").select_option("virtuosonet")
        page.locator("#renderBtn").click()
        page.wait_for_url("**/#studio",timeout=200000)
        expect(page.locator(".follow-system").first).to_be_visible(timeout=90000)
        expect(page.locator(".mixer-field small")).to_contain_text("就绪",timeout=120000)
        report["midi"] = digest(page)
    pack_cache = "pianora-asset-packs-v1"
    parts = page.evaluate("name=>caches.open(name).then(async c=>(await c.keys()).map(k=>k.url))",pack_cache)
    if args.playback:
        assert parts

    down = True
    ctx.set_offline(True)
    page.close()
    page = ctx.new_page()
    page.goto(origin + "/#library")
    expect(page.locator(".pwa-offline")).to_be_visible()
    expect(page.locator(".score-card").first).to_be_visible()
    page.locator(".score-card").first.click()
    expect(page.locator("#lyEditor")).to_have_value(source.decode())
    if args.playback:
        page.locator(".pwa-offline").click()
        page.locator(".recent-generations li button").first.click()
        expect(page.locator(".follow-system").first).to_be_visible(timeout=60000)
        assert digest(page) == report["midi"]
        page.locator("#playBtn").click()
        page.wait_for_function("Number(document.querySelector('#seekSlider').value) > 0.5")
        page.locator("#stopBtn").click()
        page.screenshot(path=args.output/"offline-studio.png")
        page.goto(origin + "/#editor")
        page.locator("#performanceModel").select_option("virtuosonet")
        page.locator("#renderBtn").click()
        page.wait_for_url("**/#studio",timeout=200000)
        assert digest(page) == report["midi"]
    report["offlineCatalogAndSource"] = True
    report["offlinePlaybackAndGeneration"] = args.playback
    ctx.set_offline(False)
    down = False
    # A failed install leaves the complete offline shell available.
    other = ctx.new_page()
    other.goto(origin + "/#library")
    revision = 2
    update = """async()=>{const reg=await navigator.serviceWorker.ready;
      const result=new Promise(resolve=>reg.addEventListener('updatefound',()=>{const w=reg.installing;
        w.addEventListener('statechange',()=>{if(['installed','redundant'].includes(w.state))resolve(w.state)})},{once:true}));
      await reg.update();return result}"""
    assert page.evaluate(update) == "redundant"
    down = True
    other.reload()
    expect(other.locator(release)).to_have_attribute("content", "1")
    down = False
    # No explicit update() or tab closing before the user's single refresh.
    revision = 3
    other.reload()
    expect(other.locator(release)).to_have_attribute("content", "3")
    assert not page.is_closed()
    # Wait for the offline document to be committed before disconnecting.
    offline_revision = """async()=>{const cache=await caches.open('pianora-pwa-static-v1');
      const html=await (await cache.match('/')).text();
      return new DOMParser().parseFromString(html,'text/html').querySelector('meta[name=qa-release]').content}"""
    deadline = time.monotonic() + 30
    while other.evaluate(offline_revision) != "3":
        assert time.monotonic() < deadline, "new offline document never activated"
        other.wait_for_timeout(100)
    down = True
    ctx.set_offline(True)
    other.reload()
    expect(other.locator(release)).to_have_attribute("content", "3")
    expect(other.locator(".score-card").first).to_be_visible()
    after = page.evaluate("name=>caches.open(name).then(async c=>(await c.keys()).map(k=>k.url))",pack_cache)
    assert set(parts).issubset(after)
    report["retainedPackChunks"] = len(parts)
    report["singleRefreshWithOtherWindowOpen"] = True
    report["offlineAfterUpgrade"] = True
    ctx.close()
server.shutdown()
(args.output/"pwa.json").write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
