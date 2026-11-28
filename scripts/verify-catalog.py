"""Verify the public catalogue via HTTP and the actual score editor; save reproducible evidence."""
import argparse, hashlib, json, os
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('url')
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
seed = Path('catalog/seed')
manifest = json.loads((seed / 'manifest.json').read_text())
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel=os.getenv('PIANORA_BROWSER', 'chrome'))
    page = browser.new_page(locale='zh-CN')
    base = args.url.rstrip('/')
    def get(path, **opts):
        return page.request.get(base + path, **opts)
    first = get('/api/catalog/scores?limit=2').json()
    second = get('/api/catalog/scores?limit=2&after=' + str(first['next'])).json()
    assert [r['id'] for r in first['items'] + second['items']] == [r['id'] for r in manifest['scores'][:4]]
    filtered = get('/api/catalog/scores?composer=Bach').json()['items']
    assert filtered and all(r['composer'] == 'Bach' for r in filtered)
    listing = get('/api/catalog/composers').json()
    assert listing['total'] >= len(manifest['scores'])
    assert {c['composer'] for c in listing['items']} >= {s['composer'] for s in manifest['scores']}
    assert get('/api/catalog/scores?after=bad').status == 400
    assert get('/api/catalog/scores/no_such_score').status == 404
    assert get('/presets/missing.ly').status == 404
    hashes = {}
    for entry in manifest['scores'] + manifest['attachments']:
        path = entry['file']
        old = get('/presets/' + quote(path), max_redirects=0)
        assert old.status in (302, 307), (path, old.status)
        url = old.headers['location']
        data = get(url)
        expected = (seed / 'files' / path).read_bytes()
        assert data.status == 200 and data.body() == expected, path
        assert get(url, headers={'If-None-Match': data.headers['etag']}).status == 304
        hashes[path] = hashlib.sha256(expected).hexdigest()
    # Exercise the actual UI cursor with the real Worker and a small first page.
    def small_page(route):
        url = route.request.url
        route.continue_(url=url + ('&' if '?' in url else '?') + 'limit=2')
    page.route('**/api/catalog/scores', small_page)
    page.goto(base)
    expect(page.locator('.score-card')).to_have_count(2)
    page.get_by_role('button', name='更多曲谱').click()
    expect(page.locator('.score-card').nth(2)).to_be_visible()
    expect(page.locator('.score-card').first).to_be_visible()
    composer_select = page.locator('#catalogComposer')
    bach_tab = page.get_by_role('tab', name='巴赫')
    composer_select.or_(bach_tab).first.wait_for()
    if composer_select.count():
        composer_select.select_option('Bach')
    else:
        bach_tab.click()
    expect(page.locator('.score-card')).to_have_count(len(filtered))
    page.locator('.score-card').first.click()
    expect(page.locator('#lyEditor')).to_have_value((seed/'files'/manifest['scores'][3]['file']).read_text())
    page.unroute('**/api/catalog/scores', small_page)
    page.reload()
    for key in ('red_dust_inn', 'sunny_day'):
        page.locator('#presetSelect').select_option(key)
        expect(page.locator('#importedScoreCard')).to_contain_text(next(s['name'] for s in manifest['scores'] if s['id'] == key))
        expect(page.locator('#renderBtn')).to_be_enabled()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'origin':base, 'composers':listing, 'verifiedFiles':hashes,
        'editorFormats':['ly','musicxml','mid'], 'pagination':True},ensure_ascii=False,indent=2)+'\n')
    print('Verified', len(hashes), 'files and three editor formats')
