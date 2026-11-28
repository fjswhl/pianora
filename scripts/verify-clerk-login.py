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
user = clerk("users", body={"email_address":[email], "skip_password_requirement":True})
music = '\\header {\n title = "Pianora Clerk E2E"\n}\n\\score { { c4 d e f } }'
def verify_performance(page, browser):
    import hashlib
    page.locator("#fileInput").set_input_files(str(Path("artifacts/browser-models/inputs/classical.mid").resolve()))
    page.locator("#importedScoreCard").wait_for()
    page.locator("#performanceModel").select_option("pianist")
    page.locator("#renderBtn").click()
    page.wait_for_url("**/#studio", timeout=300000)
    def download(button):
        with button.page.expect_download() as result:
            button.click()
        return hashlib.sha256(Path(result.value.path()).read_bytes()).hexdigest()
    final_midi = download(page.locator("#dlMidiBtn"))
    page.get_by_role("button", name="原谱演奏", exact=True).click()
    assert download(page.locator("#dlMidiBtn")) != final_midi
    page.get_by_role("button", name="保存最终演奏").click()
    uploads = []
    page.on("request", lambda request: uploads.append(request) if "/api/library" in request.url and request.method in ("POST","PUT") else None)
    page.locator("dialog .account-primary").click()
    expect(page.locator("dialog [role=status]")).to_contain_text("已保存", timeout=180000)
    row = page.locator("dialog li").filter(has=page.get_by_role("button", name="公开分享演奏")).first
    assert download(row.get_by_role("button", name="下载 MIDI")) == final_midi
    assert len(uploads) == 1
    payload = uploads[0].post_data_buffer
    assert b'name="performance"' in payload and b'name="source"' not in payload and b'audio_sha256' not in payload
    page.get_by_role("button", name="关闭").click()
    page.goto(base + "/#library")
    page.reload()
    page.get_by_role("button", name="我的曲库").click()
    row.get_by_role("button", name="打开演奏").click()
    page.wait_for_url("**/#studio")
    expect(page.locator("dialog")).to_have_count(0)
    assert download(page.locator("#dlMidiBtn")) == final_midi
    page.get_by_role("button", name="我的曲库").click()
    row.get_by_role("button", name="公开分享演奏").click()
    row = page.locator("dialog li").filter(has=page.get_by_role("link",name="打开分享页")).first
    link = base + row.get_by_role("link",name="打开分享页").get_attribute("href")
    guest = browser.new_context(viewport={"width":390,"height":844})
    listener = guest.new_page()
    assert listener.goto(link).status == 200
    assert listener.url.endswith("#studio/" + link.rsplit("/", 1)[-1])
    listener.locator("#playBtn").click()
    listener.wait_for_function("Number(document.querySelector('#seekSlider').value) > 0.2")
    assert download(listener.locator("#dlMidiBtn")) == final_midi
    assert guest.request.get(link + "/source").status == guest.request.get(link + "/audio").status == 404
    row.get_by_role("button",name="取消公开分享").click()
    expect(page.locator("dialog [role=status]")).to_contain_text("已取消")
    assert guest.request.get(link).status == guest.request.get(link + "/performance").status == 404
    guest.close()
    page.get_by_role("button",name="关闭").click()
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
        page.get_by_role("button", name="保存到曲库").click()
        identifier = page.locator('dialog input[autocomplete*=email], dialog input[name=identifier]').first
        identifier.fill(email, timeout=45000)
        identifier.press("Enter")
        page.locator('dialog input[autocomplete=one-time-code]').first.fill("424242", timeout=20000)
        expect(page.locator("dialog [role=status]")).to_contain_text("已保存", timeout=20000)
        page.get_by_role("button", name="关闭").click()
        page.reload()
        page.get_by_role("button", name="我的曲库").click()
        expect(page.locator("dialog li").first).to_contain_text("Pianora Clerk E2E", timeout=20000)
        page.get_by_role("button", name="打开乐谱").click()
        expect(page.locator("#lyEditor")).to_have_value(music)
        if os.getenv("PIANORA_TEST_PERFORMANCE"):
            performance = verify_performance(page, browser)
        page.get_by_role("button", name="我的曲库").click()
        page.get_by_role("button", name="退出登录").click()
        expect(page.locator("dialog")).to_have_count(0)
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
