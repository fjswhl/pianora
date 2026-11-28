"""Open the published editions in the score editor. Save the exact bytes verified and a playable sample."""
import argparse
import hashlib
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

args = argparse.ArgumentParser()
args.add_argument('--url', default='https://opuslin.uk')
args.add_argument('--dev-origin', help='Optional local Vite origin to engrave every verified edition using the browser engine')
args.add_argument('--output', type=Path, default=Path('artifacts/mutopia-production.json'))
args = args.parse_args()
scores = json.loads(Path('catalog/collections/mutopia-piano.json').read_text())['scores']
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    page = browser.new_page()
    page.goto(args.url + '/#editor')
    select = page.locator('#presetSelect')
    expect(select.locator('option[value="short_etude"]')).to_be_attached(timeout=20000)
    engravings = {}
    if args.dev_origin:
        compiler = browser.new_page()
        compiler.goto(args.dev_origin)
    verified = {}
    for score in scores:
        while select.locator(f'option[value="{score["id"]}"]').count() == 0:
            more = page.get_by_role('button', name='更多曲谱')
            before = select.locator('option').count()
            more.click(timeout=15000)
            page.wait_for_function('n => document.querySelector("#presetSelect").options.length > n', arg=before)
        select.select_option(score['id'])
        expect(page.locator('#renderBtn')).to_be_enabled(timeout=30000)
        actual = page.locator('#lyEditor').input_value()
        digest = hashlib.sha256(actual.encode()).hexdigest()
        if digest != score['sha256']:
            # Textareas normalize the original CRLF. Verify both the R2 bytes and displayed source.
            detail = page.request.get(args.url + '/api/catalog/scores/' + score['id']).json()
            data = page.request.get(args.url + detail['url']).body()
            assert actual == data.decode().replace('\r\n','\n'), score['id']
            digest = hashlib.sha256(data).hexdigest()
        assert digest == score['sha256'], score['id']
        verified[score['id']] = digest
        if args.dev_origin:
            result = compiler.evaluate('''async source => {
                const { BrowserLilyPondEngine } = await import('/src/engine/lilypond.ts');
                const engine = window.collectionCompiler ??= new BrowserLilyPondEngine();
                const {scoreMidi,loadPages} = await engine.compile(source);
                const pages = await loadPages();
                return {notes:scoreMidi.tracks.reduce((sum,t) => sum+t.notes.length,0),
                    pages:pages.filter(p => p.includes('<svg') && p.includes('<path')).length,
                    seconds:Math.round(scoreMidi.duration)};
            }''', actual)
            assert result['notes'] > 30 and result['pages'] > 0, score['id']
            engravings[score['id']] = result
    sample = 'chopin_op28_4'
    select.select_option(sample)
    page.locator('#renderBtn').click()
    page.wait_for_url('**/#studio', timeout=240000)
    page.get_by_role('button', name='查看谱面').click()
    expect(page.locator('.svg-sheet-page svg').first).to_be_visible(timeout=120000)
    page.get_by_role('button', name='试听与导出').click()
    page.locator('#playBtn').click()
    expect(page.locator('#playBtn')).to_have_text('暂停', timeout=90000)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'url':args.url,'browser':browser.version,'verified':verified, 'engravings':engravings,
                                      'generatedEngravedAndPlayed':sample},indent=2)+'\n')
    print(f'{len(verified)} scores verified in editor; {sample} played')
