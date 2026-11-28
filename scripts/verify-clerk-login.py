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
        expect(page.get_by_role("status")).to_contain_text("已保存", timeout=20000)
        page.get_by_role("button", name="关闭").click()
        page.reload()
        page.get_by_role("button", name="我的曲库").click()
        expect(page.locator("dialog li").first).to_contain_text("Pianora Clerk E2E", timeout=20000)
        page.get_by_role("button", name="打开乐谱").click()
        expect(page.locator("#lyEditor")).to_have_value(music)
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
