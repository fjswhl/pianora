"""Browser E2E using Clerk's development test mode and the local Pianora Worker."""
import base64
import json
import os
import uuid
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen
from playwright.sync_api import expect, sync_playwright

base = "http://127.0.0.1:8791"
secret = os.environ["CLERK_SECRET_KEY"]
with urlopen(base + "/api/account/options") as response:
    key = json.load(response)["publishableKey"]
if not secret.startswith("sk_test_") or not key or not key.startswith("pk_test_"):
    raise ValueError("A Clerk development instance and a local Worker are required")
clerk_host = base64.b64decode(key.split("_")[2] + "===").decode().removesuffix("$")

def clerk(path, method="POST", body=None):
    request = Request("https://api.clerk.com/v1/" + path, method=method,
                      data=json.dumps(body).encode() if body is not None else None,
                      headers={"Authorization":"Bearer " + secret, "Content-Type":"application/json", "User-Agent":"Pianora-Clerk-E2E/1.0"})
    with urlopen(request) as response:
        return json.load(response)

email = "pianora-" + uuid.uuid4().hex + "+clerk_test@example.com"
testing_token = clerk("testing_tokens", body={})["token"]
user = clerk("users", body={"email_address":[email], "first_name":"Aria", "last_name":"Lin", "skip_password_requirement":True})
music = '\\header {\n title = "晨光练习曲"\n}\n\\score { { c4 d e f } }'
def verify_performance(page, browser):
    import hashlib
    page.locator("#fileInput").set_input_files({"name":"夜曲片段.mid", "mimeType":"audio/midi", "buffer":Path("artifacts/browser-models/inputs/classical.mid").read_bytes()})
    page.locator("#importedScoreCard").wait_for()
    page.locator("#performanceModel").select_option("pianist")
    page.locator("#renderBtn").click()
    page.wait_for_url("**/#studio", timeout=300000)
    def download(button):
        with button.page.expect_download() as result:
            button.click()
        return hashlib.sha256(Path(result.value.path()).read_bytes()).hexdigest()
    def sheet(page):
        page.get_by_role("button", name="查看谱面",exact=True).click()
        page.locator(".svg-sheet-page").first.wait_for(timeout=120000)
        images = page.locator(".svg-sheet-page image")
        images.first.wait_for()
        hashes = images.evaluate_all("""imgs => Promise.all(imgs.map(async img =>
          Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
            await (await fetch(img.getAttribute('href'))).arrayBuffer()))).join(',')))""")
        page.get_by_role("button", name="试听与导出",exact=True).click()
        return hashes
    original_sheet = sheet(page)
    final_midi = download(page.locator("#dlMidiBtn"))
    page.get_by_role("button", name="原谱演奏", exact=True).click()
    assert download(page.locator("#dlMidiBtn")) != final_midi
    uploads = []
    page.on("request", lambda request: uploads.append(request) if "/api/library" in request.url and request.method in ("POST","PUT") else None)
    page.locator("main .studio-session").get_by_role("button", name="保存最终演奏").click()
    expect(page.locator("main .save-action [role=status]")).to_contain_text("已保存", timeout=180000)
    page.get_by_role("link", name="个人中心",exact=True).first.click()
    row = page.locator(".collection-list > li").filter(has=page.get_by_role("button", name="打开演奏")).first
    row.locator("summary").click()
    assert download(row.get_by_role("button", name="下载 MIDI")) == final_midi
    assert len(uploads) == 1
    payload = uploads[0].post_data_buffer
    assert b'name="performance"' in payload and b'name="notation"' in payload and b'name="source"' not in payload and b'audio_sha256' not in payload
    page.goto(base + "/#library")
    page.reload()
    page.get_by_role("link", name="个人中心",exact=True).first.click()
    row.get_by_role("button", name="打开演奏").click()
    page.wait_for_url("**/#studio")
    expect(page.locator("dialog")).to_have_count(0)
    assert sheet(page) == original_sheet
    assert download(page.locator("#dlMidiBtn")) == final_midi
    page.get_by_role("link", name="个人中心",exact=True).first.click()
    row = page.locator(".collection-list > li").filter(has=page.get_by_role("button",name="打开演奏")).first
    row.locator("summary").click()
    row.get_by_role("button", name="公开分享演奏").click()
    row = page.locator(".collection-list > li").filter(has=page.get_by_role("button",name="打开演奏")).first
    link = base + row.get_by_role("link",name="打开分享页").get_attribute("href")
    guest = browser.new_context(viewport={"width":390,"height":844})
    listener = guest.new_page()
    assert listener.goto(link).status == 200
    assert listener.url.endswith("#studio/" + link.rsplit("/", 1)[-1])
    listener.locator("#playBtn").click()
    listener.wait_for_function("Number(document.querySelector('#seekSlider').value) > 0.2")
    assert download(listener.locator("#dlMidiBtn")) == final_midi
    assert sheet(listener) == original_sheet
    assert guest.request.get(link + "/source").status == guest.request.get(link + "/audio").status == 404
    row.get_by_role("button",name="取消公开分享").click()
    expect(page.locator(".profile-page [role=status]")).to_contain_text("已取消")
    assert guest.request.get(link).status == guest.request.get(link + "/performance").status == 404
    guest.close()
    page.reload()
    expect(page.locator(".collection-list > li")).to_have_count(2)
    anonymize = '.profile-identity p {font-size:0} .profile-identity p::after {content:"aria@example.com";font-size:14px}'
    page.screenshot(path="artifacts/profile-desktop.png", full_page=True, style=anonymize)
    page.set_viewport_size({"width":390,"height":844})
    expect(page.locator(".collection-list > li")).to_have_count(2)
    page.get_by_role("button",name="仅看演奏").click()
    expect(page.locator(".collection-list > li")).to_have_count(1)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.get_by_role("button",name="全部作品",exact=True).click()
    page.screenshot(path="artifacts/profile-mobile.png", full_page=True, style=anonymize)
    return {"finalMidiMatchesExport":True,"singleMidiUpload":True,"privateStudio":True,"sharedStudio":True,"anonymousPlayback":True,"revokedLinkStatus":404}

performance = None
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel=os.environ.get("PIANORA_BROWSER", "chromium"))
        page = browser.new_page()
        def testing_request(route):
            url = urlparse(route.request.url)
            if url.hostname == clerk_host and url.path.startswith("/v1/"):
                query = urlencode([*parse_qsl(url.query), ("__clerk_testing_token", testing_token)])
                route.continue_(url=urlunparse(url._replace(query=query)))
            else:
                route.continue_()
        page.route("**/*", testing_request)
        page.goto(base + "/#editor")
        page.locator("#lyEditor").fill(music)
        expect(page.locator(".crumb button")).to_have_count(0)
        page.locator("main .editing").get_by_role("button", name="保存到曲库").click()
        identifier = page.locator('dialog input[autocomplete*=email], dialog input[name=identifier]').first
        identifier.fill(email, timeout=45000)
        identifier.press("Enter")
        code = page.locator('dialog input[autocomplete=one-time-code]').first
        code.fill("424242", timeout=20000)
        saved = page.locator("main .save-action [role=status]")
        needs_resend = page.get_by_text("You need to send a verification code before attempting to verify.")
        expect(saved.or_(needs_resend)).to_be_visible(timeout=30000)
        if needs_resend.is_visible():
            resend = page.locator("dialog").get_by_role("button", name="重新发送验证码", exact=True)
            resend.click(timeout=65000)
            code.fill("")
            code.fill("424242")
        expect(page.locator("main .save-action [role=status]")).to_contain_text("已保存", timeout=20000)
        page.reload()
        page.get_by_role("link", name="个人中心",exact=True).first.click()
        expect(page.locator(".collection-list > li").first).to_contain_text("晨光练习曲", timeout=20000)
        page.get_by_role("button", name="打开乐谱").click()
        expect(page.locator("#lyEditor")).to_have_value(music)
        if os.getenv("PIANORA_TEST_PERFORMANCE"):
            performance = verify_performance(page, browser)
        page.get_by_role("link", name="个人中心",exact=True).first.click()
        page.get_by_role("button", name="退出登录").click()
        expect(page.locator(".profile-guest")).to_be_visible()
        browser.close()
finally:
    clerk("users/" + user["id"], method="DELETE")
out = Path(os.environ.get("PIANORA_ARTIFACTS", "artifacts"))
out.mkdir(exist_ok=True, parents=True)
(out / "clerk-login.json").write_text(json.dumps({
    "instance":"Clerk development", "verification":"test-mode email code",
    "saveAfterSignIn":True, "restoreAfterRefresh":True, "reopenSource":True, "signOut":True
}, indent=2)+"\n")
print("Clerk development email code and private library passed")

if performance:
    (out / "shared-performance.json").write_text(json.dumps(performance, indent=2)+"\n")
