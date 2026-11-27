"""Browser E2E on a local Wrangler only. Read simulated deliveries from its private log."""
import json
import os
import re
import time
import uuid
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

base = "http://127.0.0.1:8791"
log = Path(os.environ["PIANORA_LOCAL_MAIL_LOG"])
out = Path(os.getenv("PIANORA_ARTIFACTS", "artifacts"))
out.mkdir(parents=True, exist_ok=True)
run_id = uuid.uuid4().hex[:12]
title = 'Account E2E ' + run_id
music = '\\version "2.24.3"\n\\header {\n title = "' + title + '" }\n\\score { { c\'4 d\' e\' f\' } \\layout {} \\midi {} }'
def sign_in(page, suffix):
    email = f'{run_id}-{suffix}@pianora.test'
    before = log.stat().st_size
    page.get_by_label('邮箱', exact=True).fill(email)
    page.get_by_role('button',name='发送验证码',exact=True).click()
    expect(page.get_by_label('验证码',exact=True)).to_be_visible()
    stop = time.monotonic() + 15
    while time.monotonic() < stop:
        with log.open('rb') as f:
            f.seek(before)
            text = f.read().decode(errors='replace')
        paths = re.findall(r'Text: (.+?\.txt)',text)
        if email in text and paths:
            content=Path(paths[-1]).read_text()
            code=re.search(r'(?<!\d)\d{6}(?!\d)',content).group()
            break
        time.sleep(.1)
    else: raise RuntimeError('No simulated mail delivered')
    page.get_by_label('验证码',exact=True).fill(code)
    page.get_by_role('button',name='验证并登录').click()
    expect(page.get_by_role('button',name='退出登录')).to_be_visible()
    return email

with sync_playwright() as pw:
    browser=pw.chromium.launch(channel=os.getenv('PIANORA_BROWSER','chromium'))
    previous = os.getenv('PIANORA_PREVIOUS_SESSION')
    if previous:
        restored = browser.new_context(storage_state=previous)
        existing = restored.request.get(base+'/api/library')
        assert existing.ok and len(existing.json()) > 0, 'Previous release session did not survive'
        assert restored.request.get(base+'/api/library/'+existing.json()[0]['id']+'/source').ok
        restored.close()
    owner=browser.new_context()
    page=owner.new_page()
    page.goto(base+'/#editor')
    expect(page.locator('#lyEditor')).not_to_have_value('')
    page.locator('#lyEditor').fill(music)
    page.get_by_role('button',name='保存到曲库').click()
    sign_in(page,'owner')
    expect(page.get_by_role('status')).to_contain_text('已保存')
    listing=page.request.get(base+'/api/library').json()
    score_id=listing[0]['id']
    source_url=base+'/api/library/'+score_id+'/source'
    assert page.request.get(source_url).body().decode() == music
    if os.getenv('PIANORA_CAPTURE_SESSION'):
        owner.storage_state(path=os.environ['PIANORA_CAPTURE_SESSION'])
        print('Previous release session prepared')
        browser.close()
        raise SystemExit(0)
    page.reload()
    page.get_by_role('button',name='我的曲库').click()
    expect(page.locator('dialog li').first).to_contain_text(title)
    page.get_by_role('button',name='打开乐谱').click()
    expect(page.locator('#lyEditor')).to_have_value(music)

    if os.getenv('PIANORA_TEST_GENERATION'):
        page.locator('#renderBtn').click()
        page.wait_for_url('**/#studio',timeout=180000)
        page.get_by_role('button',name='保存到曲库').click()
        page.get_by_role('button',name='保存《'+title+'》').click()
        expect(page.get_by_role('button',name='试听演奏')).to_be_visible()
        page.get_by_role('button',name='试听演奏').click()
        expect(page.get_by_role('button',name='停止试听')).to_be_visible()
        page.get_by_role('button',name='停止试听').click()
        perf=next(x for x in page.request.get(base+'/api/library').json() if x['has_performance'])
        assert page.request.get(base+'/api/library/'+perf['id']+'/performance').body().startswith(b'MThd')
        page.get_by_role('button',name='关闭').click()

    other=browser.new_context()
    p2=other.new_page()
    p2.goto(base)
    p2.get_by_role('button',name='我的曲库').click()
    sign_in(p2,'second')
    assert p2.request.get(source_url).status==404
    assert p2.request.get(base+'/api/library').json()==[]
    assert p2.request.post(base+'/api/library',headers={'Origin':'https://elsewhere.invalid'}).status==403
    page.get_by_role('button',name='我的曲库').click()
    page.get_by_role('button',name='退出登录').click()
    expect(page.locator('dialog')).to_have_count(0)
    assert page.request.get(source_url).status==401
    browser.close()

report={'simulatedOtp':True,'saveAfterLogin':True,'sessionAfterRefresh':True,'reopenSource':True,
        'crossAccountRead':404,'signedOutRead':401,'foreignOriginWrite':403,'generatedTakeTested':bool(os.getenv('PIANORA_TEST_GENERATION'))}
(out/'accounts.json').write_text(json.dumps(report,indent=2)+'\n')
print('Account E2E passed')
