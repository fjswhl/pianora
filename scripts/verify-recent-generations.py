"""Run against a local production build with the Pianist model pack installed."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:4173')
args = parser.parse_args()
report_path = Path('artifacts/recent-generations.json')


def scale_file():
    # Two bars of eighth notes with changing velocity, followed by a full cadence.
    events = bytearray()
    for index, pitch in enumerate([60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 48]):
        events.extend((0, 0x90, pitch, 60 + index * 2, 48, 0x80, pitch, 0))
    events.extend((0, 0xff, 0x2f, 0))
    header = bytes.fromhex('4d54686400000006000000010060')
    return {'name': 'Scale.mid', 'mimeType': 'audio/midi',
            'buffer': header + b'MTrk' + len(events).to_bytes(4, 'big') + events}


def final_digest(page):
    with page.expect_download() as download:
        page.locator('#dlMidiBtn').click()
    return hashlib.sha256(Path(download.value.path()).read_bytes()).hexdigest()


def check_engraved_history(browser):
    context = browser.new_context(locale='zh-CN')
    page = context.new_page()
    page.goto(args.url + '/#editor')
    page.locator('#performanceModel').select_option('pianist')
    page.locator('#renderBtn').click()
    page.wait_for_url('**/#studio', timeout=180000)
    expect(page.locator('.follow-system').first).to_be_visible(timeout=90000)
    original = final_digest(page)
    page.close()
    restored = context.new_page()
    restored.route('**/lilypond-*.wasm', lambda route: route.abort())
    restored.route('**/performance-packs/**', lambda route: route.abort())
    restored.goto(args.url + '/#studio')
    restored.locator('.recent-generations li button').click()
    expect(restored.locator('.follow-system').first).to_be_visible(timeout=60000)
    assert final_digest(restored) == original
    assert not restored.evaluate("performance.getEntriesByType('measure').some(e => e.name.startsWith('pianora:lilypond-'))")
    context.close()
    return True


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel=os.environ.get('PIANORA_BROWSER', 'chrome'))
    engraved = check_engraved_history(browser)
    print('Restored LilyPond notation', flush=True)
    context = browser.new_context(locale='zh-CN', viewport={'width': 390, 'height': 844})
    page = context.new_page()
    page.goto(args.url + '/#studio')
    expect(page.get_by_text('这台设备还没有生成记录。')).to_be_visible()
    for seed in range(101, 112):
        page.locator('nav a[href="#editor"]').click()
        if seed == 101:
            page.locator('#fileInput').set_input_files(scale_file())
            page.locator('#performanceModel').select_option('pianist')
        advanced = page.locator('details.advanced')
        if not advanced.evaluate('(element) => element.open'):
            advanced.locator('summary').click()
        page.locator('#seed').fill(str(seed))
        page.locator('#batchCount').select_option('2' if seed == 102 else '1')
        page.locator('#renderBtn').click()
        page.wait_for_url('**/#studio', timeout=180000)
        print(f'Generated seed {seed}', flush=True)
        if seed == 101:
            page.locator('#reverbSlider').focus()
            page.locator('#reverbSlider').press('End')
            expected_wet = page.locator('#reverbSlider').input_value()
        if seed == 102:
            page.locator('#takesBar').select_option(index=1)
            original = final_digest(page)
    page.locator('nav a[href="#editor"]').click()
    page.locator('#renderBtn').click()
    page.get_by_role('button', name='取消生成', exact=True).click()
    expect(page.locator('#errBox')).to_be_visible(timeout=30000)
    # Deny only the history write. The generated performance must still work.
    page.evaluate("""() => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function(...args) {
        if (this.name === 'entries') throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return add.apply(this, args);
      };
    }""")
    page.locator('#renderBtn').click()
    page.wait_for_url('**/#studio', timeout=180000)
    expect(page.get_by_text('演奏已生成，但浏览器未能保存本次记录。')).to_be_visible()
    assert len(final_digest(page)) == 64
    page.close()
    page = context.new_page()
    page.route('**/performance-packs/**', lambda route: route.abort())
    page.goto(args.url + '/#studio')
    rows = page.locator('.recent-generations li button')
    expect(rows).to_have_count(10)
    seeds = [int(row.split('Seed ')[1].split()[0]) for row in rows.all_inner_texts()]
    assert seeds == list(range(111, 101, -1)), seeds
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    rows.last.click()
    expect(page.locator('#takesBar option')).to_have_count(2)
    page.locator('#takesBar').select_option(index=1)
    assert final_digest(page) == original
    expect(page.locator('#reverbSlider')).to_have_value(expected_wet)
    page.locator('#playBtn').click()
    expect(page.locator('#playBtn')).to_contain_text('暂停')
    page.wait_for_function("Number(document.querySelector('#seekSlider').value) > 0.2")
    page.locator('#stopBtn').click()
    page.get_by_role('button', name='显示 MIDI 随奏谱').click()
    page.wait_for_selector('.follow-score svg', timeout=60000)
    page.reload()
    expect(rows).to_have_count(10)
    assert rows.first.inner_text().split('Seed ')[1].split()[0] == '111'
    report_path.write_text(json.dumps(dict(generations=11, retainedSeeds=seeds,
        restoredBatchSize=2, restoredFinalMidiSha256=original, playbackAdvanced=True,
        restoredNotation=True, restoredLilyPondWithoutCompiler=engraved, reopenedWithoutModel=True, cancellationPreservedHistory=True,
        storageFailureKeptPerformance=True, restoredReverb=expected_wet, mobileViewport=390), indent=2) + '\n')
    browser.close()
