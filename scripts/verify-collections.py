"""Verify server pagination, nested browser filters and opening a score across categories."""
import argparse, hashlib, json, os, re
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('url')
parser.add_argument('--minimum', type=int, default=1000)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--play', action='store_true', help='Generate, engrave and play the last opened score')
parser.add_argument('--manifest',type=Path,help='Verify every published file and open samples from this batch')
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
    classical = [s for s in scores if s['collection'] not in ('原创钢琴小品', '流行钢琴改编')]
    formats = Counter(Path(s['file']).suffix for s in classical)
    if args.minimum >= 1000:
        assert len(classical) >= 1000 and set(formats) <= {'.ly','.musicxml','.xml','.mxl'}, formats
    composers = pages('composers')
    for c in composers:
        sets = pages('collections', composer=c['composer'])
        assert sum(a['pieces'] for a in sets)==c['pieces']
        assert all(counts[c['composer'],a['collection']]==a['pieces'] for a in sets)
    page.goto(base)
    def select_composer(key, name):
        page.locator('#catalogComposer').or_(page.get_by_role('tab', name=name)).first.wait_for()
        if page.locator('#catalogComposer').count():
            chooser = page.locator('#catalogComposer')
            if not chooser.evaluate('(el, key) => [...el.options].some(o => o.value === key)', key):
                page.get_by_role('button', name='更多作曲家').click()
            chooser.select_option(key)
        else:
            page.get_by_role('tab', name=name).click()
    select_composer('Beethoven','贝多芬')
    menu = page.get_by_label('作品集', exact=True)
    menu.select_option('悲怆奏鸣曲 · Op. 13')
    expect(page.locator('.score-card')).to_have_count(3)
    page.locator('.score-card').first.click()
    expect(page.locator('#presetSelect')).to_have_value('beethoven_pathetique_1')
    opened = []
    if args.minimum >= 1000:
        samples = [
            ('Scarlatti','斯卡拉蒂','键盘奏鸣曲 · K. 001–010','scarlatti_k1'),
            ('Czerny','车尔尼','初步教程 · Op. 599','pdmx_6080531'),
            ('Czerny','车尔尼','50 首旋律练习曲 · Op. 840','mutopia_2146'),
        ]
        if args.manifest:
            editions = json.loads(args.manifest.read_text())['scores']
            published = {score['id']:score for score in scores}
            for edition in editions:
                score = published[edition['id']]
                for field in ('name','composer','collection','file','sha256','license','sourceUrl'):
                    assert score[field] == edition[field], (edition['id'],field)
            for start in range(0, len(editions), 6):
                batch = [published[e['id']] for e in editions[start:start+6]]
                digests = page.evaluate("""async urls => Promise.all(urls.map(async url => {
                    const response = await fetch(url);
                    if (!response.ok) throw Error(response.status + ' ' + url);
                    const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
                    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
                }))""", [score['url'] for score in batch])
                for score, digest in zip(batch, digests, strict=True):
                    assert digest == score['sha256'], score['id']
            samples = [(s['composer'],s['composer'],s['collection'],s['id'])
                       for s in (editions[0], editions[len(editions)//2], editions[-1])]
        for composer, translated, collection, sample in samples:
            page.goto(base)
            select_composer(composer, translated)
            menu.select_option(collection)
            expected = next(s for s in scores if s['id'] == sample)
            card = page.locator('.score-card').filter(has=page.locator('.catalogue-no', has_text=re.compile(rf"^PN / {expected['number']:03}$")))
            card.first.click()
            expect(page.locator('#presetSelect')).to_have_value(sample)
            if expected['file'].endswith('.ly'):
                expect(page.locator('#lyEditor')).to_have_value(re.compile(r'\\version'), timeout=30000)
            else:
                expect(page.locator('#importedScoreCard')).to_be_visible(timeout=30000)
            download = page.get_by_role('link',name='下载原谱')
            with page.expect_download() as saved:
                download.click()
            assert saved.value.suggested_filename == Path(expected['file']).name
            assert hashlib.sha256(Path(saved.value.path()).read_bytes()).hexdigest() == expected['sha256']
            expect(page.locator('#renderBtn')).to_be_enabled()
            expect(page.get_by_role('link',name='版本来源')).to_have_attribute('href', expected['sourceUrl'])
            opened.append(sample)
    if args.play:
        assert opened
        page.locator('#renderBtn').click()
        page.wait_for_url('**/#studio', timeout=240000)
        page.get_by_role('button', name='查看谱面').click()
        expect(page.locator('.svg-sheet-page svg').first).to_be_visible(timeout=150000)
        page.get_by_role('button', name='试听与导出').click()
        page.locator('#playBtn').click()
        expect(page.locator('#playBtn')).to_have_text('暂停', timeout=90000)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps({'url':base,'scores':len(scores),'collections':len(counts),
        'classicalScores':len(classical),'classicalFormats':dict(formats),
        'classicalComposers':len({s['composer'] for s in classical}),
        'classicalCollections':len({(s['composer'],s['collection']) for s in classical}),
        'verifiedManifest':args.manifest.name if args.manifest else None,
        'composers':composers,'openedScores':opened,'played':opened[-1] if args.play else None,'verifiedNestedNavigation':True},ensure_ascii=False,indent=2)+'\n')
