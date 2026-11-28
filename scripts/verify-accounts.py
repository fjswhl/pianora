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
    expect(page.get_by_role("link", name="个人中心", exact=True)).to_be_visible()
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
      // A recording remains private and unlisted while the audio upload is incomplete.
      const bytes = new Uint8Array([255,251,144,100,0,0,0,0]);
      const sha = await crypto.subtle.digest('SHA-256',bytes);
      form.set('audio_sha256',Array.from(new Uint8Array(sha),x=>x.toString(16).padStart(2,'0')).join(''));
      form.set('take_label','Final take');
      const upload = await (await write()).json();
      const item = path+'/'+upload.id;
      const share = (token,method) => fetch(item+'/share',{headers:headers(token),method});
      report.pending = upload.ready === false && (await share(tokens.owner,'POST')).status === 404;
      const audioPut = await fetch(item+'/audio',{method:'PUT',headers:{...headers(tokens.owner),'Content-Type':'audio/mpeg'},body:bytes});
      report.uploaded = audioPut.ok && (await (await write()).json()).ready;
      report.foreignPublish = (await share(tokens.other,'POST')).status;
      const published = await (await share(tokens.owner,'POST')).json();
      const link = '/p/'+published.share_id;
      report.recordingMidiPrivate = (await fetch(link+'/performance')).status;
      report.publicPage = (await fetch(link)).status;
      report.range = (await fetch(link+'/audio',{headers:{Range:'bytes=1-3'}})).status;
      report.rangeMatches = (await (await fetch(link+'/audio',{headers:{Range:'bytes=1-3'}})).arrayBuffer()).byteLength === 3;
      report.publicSource = (await fetch(link+'/source')).status;
      report.foreignRevoke = (await share(tokens.other,'DELETE')).status;
      await share(tokens.owner,'DELETE');
      report.revoked = (await fetch(link+'/audio')).status;
      report.privateAudio = (await read(item+'/audio',tokens.owner)).status;
      report.rotated = (await (await share(tokens.owner,'POST')).json()).share_id !== published.share_id;
      // MIDI shares expose the final file only. Existing recording shares keep their MP3-only contract.
      form.delete('source'); form.delete('audio_sha256');
      const midiBytes = Uint8Array.of(77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,4,0,255,47,0);
      form.set('performance',new Blob([midiBytes]),'final.mid');
      const midiItem = path+'/'+(await (await write()).json()).id;
      const midiPublish = await fetch(midiItem+'/share',{method:'POST',headers:headers(tokens.owner)});
      const midiLink = '/p/'+(await midiPublish.json()).share_id;
      const midiResponse = await fetch(midiLink+'/performance');
      report.midiShare = midiResponse.status === 200 && midiResponse.headers.get('content-type') === 'audio/midi' &&
        String(new Uint8Array(await midiResponse.arrayBuffer())) === String(midiBytes);
      report.midiSource = (await fetch(midiLink+'/source')).status;
      report.midiAudio = (await fetch(midiLink+'/audio')).status;
      const notationPath = midiItem+'/notation';
      const sheetBytes = Uint8Array.of(31,139,8,1,2,3);
      const attach = (token, bytes) => fetch(notationPath,{method:'PUT',headers:headers(token),body:bytes});
      report.missingNotation = (await read(notationPath,tokens.owner)).status;
      report.foreignNotationWrite = (await attach(tokens.other,sheetBytes)).status;
      report.repaired = (await attach(tokens.owner,sheetBytes)).ok;
      await attach(tokens.owner,Uint8Array.of(4));
      const matches = async response => String(new Uint8Array(await response.arrayBuffer())) === String(sheetBytes);
      report.privateNotation = await matches(await read(notationPath,tokens.owner));
      report.foreignNotation = (await read(notationPath,tokens.other)).status;
      report.sharedNotation = await matches(await fetch(midiLink+'/notation'));
      form.set('notation',new Blob([sheetBytes]),'notation.gz');
      const packet = await (await write()).json();
      report.savedNotation = await matches(await read(path+'/'+packet.id+'/notation',tokens.owner));
      await fetch(midiItem+'/share',{method:'DELETE',headers:headers(tokens.owner)});
      report.midiRevoked = (await fetch(midiLink+'/performance')).status;
      report.revokedNotation = (await fetch(midiLink+'/notation')).status;
      return report;
    }""", {"tokens": tokens, "source": source})
    result["foreignWrite"] = page.request.post(base+"/api/library", headers={
        "Origin":"https://other.test","Authorization":"Bearer "+tokens["owner"]}).status
    browser.close()
expected = dict(saved=201, repeated=200, ownEntries=1, source=True, take=True, private=404,
                otherEntries=0, signedOut=401, expired=401, pending=401, foreign=401, wrongIssuer=401, foreignWrite=403)
expected.update(pending=True, uploaded=True, foreignPublish=404, publicPage=200, range=206, rangeMatches=True,
                publicSource=404, foreignRevoke=404, revoked=404, privateAudio=200, rotated=True, recordingMidiPrivate=404,
                midiShare=True, midiSource=404, midiAudio=404, midiRevoked=404)
expected.update(missingNotation=404,foreignNotationWrite=404,repaired=True,privateNotation=True,
                foreignNotation=404,sharedNotation=True,savedNotation=True,revokedNotation=404)
assert result == expected, result
out = Path(os.environ.get("PIANORA_ARTIFACTS", "artifacts"))
out.mkdir(parents=True, exist_ok=True)
(out / "accounts.json").write_text(json.dumps({"verification":"local Worker with signed session fixtures", **result}, indent=2)+"\n")
print("Account E2E passed")
