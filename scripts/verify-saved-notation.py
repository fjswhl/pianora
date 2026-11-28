"""Optional browser round trip in ci-accounts.sh with a local Vite server and restored model packs."""
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

dev = os.environ["PIANORA_NOTATION_DEV_URL"]
worker = "http://127.0.0.1:8791"
owner = json.loads((Path(os.environ["PIANORA_TEST_DIR"]) / "sessions.json").read_text())["owner"]
output = Path(os.environ.get("PIANORA_ARTIFACTS", "artifacts"))
output.mkdir(parents=True, exist_ok=True)
score = Path("catalog/seed/files/schumann/schumann_traumerei_op15_no7.ly")
clerk_stub = """
export const ClerkProvider = ({ children }) => children;
export const ClerkFailed = () => null, SignIn = () => null;
export const useAuth = () => ({isLoaded:true, userId:'fixture', getToken:async ()=>'fixture'});
export const useClerk = () => ({signOut:async()=>{}}), useUser = () => ({user:{fullName:'Pianist'}});
"""


def wire(ctx):
    ctx.route("**/@clerk_react.js*", lambda r: r.fulfill(content_type="application/javascript", body=clerk_stub))

    def forward(route):
        req = route.request
        url = urlsplit(req.url)
        headers = {"Origin": worker}
        if req.headers.get("authorization") == "Bearer fixture":
            headers["Authorization"] = "Bearer " + owner
        if "content-type" in req.headers:
            headers["Content-Type"] = req.headers["content-type"]
        res = ctx.request.fetch(worker + url.path, method=req.method, headers=headers,
                                data=req.post_data_buffer, max_redirects=0)
        route.fulfill(response=res)

    for path in ["**/api/account/options", "**/api/library", "**/api/library/**", "**/p/**"]:
        ctx.route(path, forward)


def snapshot(page):
    page.locator(".follow-system").first.wait_for(timeout=120000)
    bars = []
    for seconds in [10, 30, 55, 0]:
        page.locator("#seekSlider").evaluate("""async (el, sec) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el,String(sec));
          el.dispatchEvent(new Event('input',{bubbles:true}));
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        }""",seconds)
        bars.append(page.locator(".follow-highlight").get_attribute("data-bar"))
    assert len(set(bars)) >= 3, bars
    page.get_by_role("button", name="查看谱面", exact=True).click()
    images = page.locator(".svg-sheet-page image")
    images.first.wait_for(timeout=120000)
    hashes = images.evaluate_all("""imgs => Promise.all(imgs.map(async img =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
        await (await fetch(img.getAttribute('href'))).arrayBuffer())), b=>b.toString(16).padStart(2,'0')).join('')))""")
    page.get_by_role("button", name="试听与导出", exact=True).click()
    with page.expect_download() as dl:
        page.locator("#dlMidiBtn").click()
    return {"bars":bars,"pages": hashes, "midi": hashlib.sha256(Path(dl.value.path()).read_bytes()).hexdigest()}


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel=os.environ.get("PIANORA_BROWSER", "chrome"))
    ctx = browser.new_context(locale="zh-CN")
    wire(ctx)
    page = ctx.new_page()
    page.goto(dev + "/#editor")
    page.locator("#fileInput").set_input_files(score)
    page.wait_for_function("document.querySelector('#lyEditor')?.value.includes('Kinderscenen')")
    page.locator("#performanceModel").select_option("virtuosonet")
    page.locator("#renderBtn").click()
    page.wait_for_function("location.hash === '#studio' || document.querySelector('#errBox')", timeout=240000)
    assert page.url.endswith("#studio"), page.locator("#errBox").inner_text()
    print("Generated Kinderscenen",flush=True)
    original = snapshot(page)
    page.get_by_role("button", name="保存最终演奏", exact=True).click()
    expect(page.locator(".save-action [role=status]")).to_contain_text("已保存", timeout=120000)
    page.goto(dev + "/#profile")
    row = page.locator(".collection-list li").filter(has_text="Kinderscenen").first
    row.get_by_role("button", name="打开演奏").click()
    page.wait_for_url("**/#studio")
    assert snapshot(page) == original
    # Also recreate a previous-version entry by saving just the exact downloaded MIDI.
    with page.expect_download() as dl:
        page.locator("#dlMidiBtn").click()
    midi_bytes = Path(dl.value.path()).read_bytes()
    legacy = ctx.request.post(worker+"/api/library", headers={"Origin":worker, "Authorization":"Bearer "+owner},
                              multipart={"title":"Kinderscenen", "take_label":"old save",
                                         "performance":{"name":"take.mid","mimeType":"audio/midi","buffer":midi_bytes}})
    assert legacy.status == 201
    page.goto(dev + "/#profile")
    old = page.locator(".collection-list li").filter(has_text="old save")
    with page.expect_response(lambda r: "/notation" in r.url and r.request.method == "PUT") as repair:
        old.get_by_role("button", name="打开演奏").click()
    assert repair.value.ok
    assert snapshot(page) == original
    page.goto(dev + "/#profile")
    old.locator("summary").click()
    old.get_by_role("button",name="公开分享演奏").click()
    link = old.get_by_role("link",name="打开分享页").get_attribute("href")
    guest = browser.new_context(locale="zh-CN")
    wire(guest)
    listener = guest.new_page()
    listener.goto(dev + "/#studio/" + link.rsplit("/", 1)[-1])
    assert snapshot(listener) == original
    listener.locator(".follow-score").screenshot(path=output/"saved-kinderscenen.png")
    (output/"saved-notation.json").write_text(json.dumps({"score":score.name, **original,
        "verified":["generation","library","legacy repair","shared in fresh browser"]},indent=2))
    print("Verified original sheet and final MIDI across library, legacy repair and share")
    browser.close()
