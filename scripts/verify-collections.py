"""Verify server pagination, nested browser filters and opening a score across categories."""
import argparse, json, os
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('url')
parser.add_argument('--minimum', type=int, default=1000)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel=os.getenv('PIANORA_BROWSER','chrome'))
    page = browser.new_page(viewport={'width':390,'height':844})
    base = args.url.rstrip('/')
    def pages(endpoint, **query):
        rows = []
        while True:
            response = page.request.get(base+'/api/catalog/'+endpoint+'?'+urlencode(query))
            assert response.ok, (response.status, endpoint, query)
            data = response.json()
            rows.extend(data['items'])
            if data['next'] is None:
                return rows
            query['after'] = data['next']
    scores = pages('scores',limit=64)
    counts = {}
    for song in scores:
        assert song['collection'] and song['id']
        key = song['composer'], song['collection']
        counts[key] = counts.get(key,0)+1
    assert len({s['id'] for s in scores}) == len(scores) >= args.minimum
    composers = pages('composers')
    for c in composers:
        sets = pages('collections', composer=c['composer'])
        assert sum(a['pieces'] for a in sets)==c['pieces']
        assert all(counts[c['composer'],a['collection']]==a['pieces'] for a in sets)
    page.goto(base)
    def select_composer(key, name):
        page.locator('.score-card').first.wait_for()
        if page.locator('#catalogComposer').count():
            page.locator('#catalogComposer').select_option(key)
        else:
            page.get_by_role('tab', name=name).click()
    select_composer('Beethoven','贝多芬')
    menu = page.get_by_label('作品集', exact=True)
    menu.select_option('悲怆奏鸣曲 · Op. 13')
    expect(page.locator('.score-card')).to_have_count(3)
    page.locator('.score-card').first.click()
    expect(page.locator('#presetSelect')).to_have_value('beethoven_pathetique_1')
    if args.minimum >= 1000:
        page.goto(base)
        select_composer('Scarlatti','斯卡拉蒂')
        menu.select_option(index=1)
        page.locator('.score-card').first.click()
        expect(page.locator('#importedScoreCard')).to_be_visible(timeout=30000)
        expect(page.locator('#renderBtn')).to_be_enabled()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps({'url':base,'scores':len(scores),'collections':len(counts),
        'composers':composers,'verifiedNestedNavigation':True},ensure_ascii=False,indent=2)+'\n')
