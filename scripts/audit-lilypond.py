"""Compile curated sources in real browser workers. Keep one JSONL record per attempted score."""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('manifests', type=Path, nargs='+')
parser.add_argument('--dev-origin', default='http://localhost:5173')
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--workers', type=int, default=3)
args = parser.parse_args()

async def main():
    queue = asyncio.Queue()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    completed = set()
    if args.output.exists():
        for line in args.output.read_text().splitlines():
            record = json.loads(line)
            if record.get('pages'):
                completed.add((record['id'], record['sha256']))
    for manifest in args.manifests:
        for row in json.loads(manifest.read_text())['scores']:
            if row['file'].endswith('.ly') and (row['id'], row['sha256']) not in completed:
                queue.put_nowait(row)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel=os.getenv('PIANORA_BROWSER','chrome'),
            args=['--disable-background-timer-throttling','--disable-renderer-backgrounding'])
        async def worker():
            page = None
            try:
                while not queue.empty():
                    row = queue.get_nowait()
                    data = (args.directory / row['file']).read_bytes()
                    digest = hashlib.sha256(data).hexdigest()
                    assert digest == row['sha256'], row['id']
                    record = {'id':row['id'], 'sha256':digest}
                    try:
                        if not page:
                            page = await browser.new_page()
                            # Load only the compiler modules. The Vite application shell enables
                            # hot reload when an audit report is saved inside the workspace.
                            await page.route(args.dev_origin.rstrip('/') + '/', lambda route:
                                route.fulfill(content_type='text/html', body='<title>Score audit</title>'))
                            await page.goto(args.dev_origin, wait_until='domcontentloaded')
                        result = await asyncio.wait_for(page.evaluate('''async source => {
                          const {BrowserLilyPondEngine} = await import('/src/engine/lilypond.ts');
                          const engine = window.auditEngine ??= new BrowserLilyPondEngine();
                          const {scoreMidi, loadPages} = await engine.compile(source);
                          const pages = await loadPages();
                          return {notes:scoreMidi.tracks.reduce((n,t)=>n+t.notes.length,0),
                            seconds:scoreMidi.duration, pages:pages.filter(p=>p.includes('<svg') && p.includes('<path')).length};
                        }''', data.decode()), 120)
                        assert result['notes'] and result['pages'] and result['seconds'], result
                        record.update(result)
                    except Exception as error:
                        record['error'] = str(error)[:450]
                        if page: await page.close()
                        page = None
                    with args.output.open('a') as f:
                        f.write(json.dumps(record)+'\n')
            finally:
                if page: await page.close()
        await asyncio.gather(*(worker() for _ in range(args.workers)))
        await browser.close()
asyncio.run(main())
