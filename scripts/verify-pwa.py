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
revision = 1
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
        if path == "/sw.js":
            cfg = dict(build)
            if revision > 1:
                cfg.update(html=build["html"].replace("</head>", '<meta name="qa-release" content="2"></head>'),
                           assets=build["assets"] + ["/assets/test-release.css"],
                           core=build["core"] + ["/assets/test-release.css"])
            return self.body(("const BUILD = " + json.dumps(cfg) + ";\n" + code +
                              f"\n// test build {revision}").encode(), "text/javascript")
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
    page.goto(origin)
    page.wait_for_function("!!navigator.serviceWorker.controller")
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
    # Failed staging must leave the running app intact. A successful update
    # must wait for both open windows and reuse the existing model cache.
    other = ctx.new_page()
    other.goto(origin)
    revision = 2
    update = """async()=>{const reg=await navigator.serviceWorker.ready;
      const result=new Promise(resolve=>reg.addEventListener('updatefound',()=>{const w=reg.installing;
        w.addEventListener('statechange',()=>{if(['installed','redundant'].includes(w.state))resolve(w.state)})},{once:true}));
      await reg.update();return result}"""
    assert page.evaluate(update) == "redundant"
    revision = 3
    assert page.evaluate(update) == "installed"
    page.close()
    other.reload()
    assert other.locator('meta[name="qa-release"]').count() == 0
    other.close()
    # Wait in the worker, with no old tab remaining.
    ctx.service_workers[-1].evaluate("""async()=>{for(let n=0;n<150;n++){
      if(self.registration.active?.state==='activated'&&!self.registration.waiting)return;
      await new Promise(r=>setTimeout(r,100));}throw Error('Update failed to activate')}""")
    page = ctx.new_page()
    page.goto(origin)
    assert page.locator('meta[name="qa-release"]').count() == 1
    after = page.evaluate("name=>caches.open(name).then(async c=>(await c.keys()).map(k=>k.url))",pack_cache)
    assert set(parts).issubset(after)
    report["retainedPackChunks"] = len(parts)
    report["updateAfterLastWindowClosed"] = True
    ctx.close()
server.shutdown()
(args.output/"pwa.json").write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
