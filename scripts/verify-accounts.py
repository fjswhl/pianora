"""Run through ci-accounts.sh. Browser requests use ephemeral signed Clerk-shaped sessions."""
import json
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

base = "http://127.0.0.1:8791"
tokens = json.loads((Path(os.environ["PIANORA_TEST_DIR"]) / "sessions.json").read_text())
source = r'\score { { c4 d e f } }'
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel=os.environ.get("PIANORA_BROWSER", "chromium"))
    page = browser.new_page()
    page.goto(base + "/#editor")
    expect(page.get_by_role("button", name="我的曲库")).to_be_visible()
    result = page.evaluate("""async ({tokens, source}) => {
      const path = '/api/library';
      const headers = token => ({Authorization: 'Bearer '+token});
      const read = (url, token) => fetch(url, {headers:token ? headers(token) : {}});
      const form = new FormData();
      form.set('title','Clerk E2E'); form.set('source', new File([source], 'score.ly'));
      form.set('performance',new Blob(['MThd']), 'take.mid');
      const write = () => fetch(path, {method:'POST', headers:headers(tokens.owner), body:form});
      const saved = await write();
      const {id} = await saved.json();
      const repeated = await write();
      const mine = await (await read(path, tokens.owner)).json();
      const file = path+'/'+id+'/source';
      const report = {
        saved:saved.status, repeated:repeated.status, ownEntries:mine.length,
        source:(await (await read(file,tokens.owner)).text()) === source,
        take:await (await read(path+'/'+id+'/performance',tokens.owner)).text() === 'MThd',
        private:(await read(file,tokens.other)).status,
        otherEntries:(await (await read(path,tokens.other)).json()).length,
        signedOut:(await read(file)).status,
      };
      for (const k of ['expired','pending','foreign','wrongIssuer'])
        report[k] = (await read(file,tokens[k])).status;
      return report;
    }""", {"tokens": tokens, "source": source})
    result["foreignWrite"] = page.request.post(base+"/api/library", headers={
        "Origin":"https://other.test","Authorization":"Bearer "+tokens["owner"]}).status
    browser.close()
expected = dict(saved=201, repeated=200, ownEntries=1, source=True, take=True, private=404,
                otherEntries=0, signedOut=401, expired=401, pending=401, foreign=401, wrongIssuer=401, foreignWrite=403)
assert result == expected, result
out = Path(os.environ.get("PIANORA_ARTIFACTS", "artifacts"))
out.mkdir(parents=True, exist_ok=True)
(out / "accounts.json").write_text(json.dumps({"verification":"local Worker with signed session fixtures", **result}, indent=2)+"\n")
print("Account E2E passed")
