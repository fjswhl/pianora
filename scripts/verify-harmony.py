"""Browser E2E with local runtime assets. Start npm run preview before running."""
import json
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

out = Path(os.getenv("PIANORA_ARTIFACTS", "artifacts"))
out.mkdir(parents=True, exist_ok=True)
url = os.getenv("PIANORA_URL", "http://127.0.0.1:4173")
ly = r'''\version "2.24.3"
\header { title = "Harmony study" }
\score {
  \new Staff { \key c \major \time 4/4 \tempo 4 = 60
    <d' f' a' c''>2 <g b d' f'>2 | <c' e' g'>1 | }
  \layout {} \midi {}
}'''
# Deliberately write Fmaj7 over a C triad. This verifies source priority.
xml = """<score-partwise version="3.1"><part-list><score-part id="p"><part-name>Piano</part-name></score-part></part-list>
<part id="p"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<harmony><root><root-step>F</root-step></root><kind>major-seventh</kind></harmony>
%s<harmony><root><root-step>G</root-step></root><kind>dominant</kind></harmony>%s
</measure></part></score-partwise>"""
def triad(notes):
    return ''.join(f'<note>{("<chord/>" if i else "")}<pitch><step>{p}</step><octave>4</octave></pitch>'
                   '<duration>2</duration><type>half</type></note>' for i,p in enumerate(notes))

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel=os.getenv('PIANORA_BROWSER','chrome'))
    page = browser.new_page(viewport={'width':1280,'height':900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url + '/#editor')
    editor = page.locator('#lyEditor')
    expect(editor).not_to_have_value('')
    editor.fill(ly)
    def generate():
        page.locator('#renderBtn').click()
        page.wait_for_function("location.hash === '#studio' || document.querySelector('#errBox')", timeout=240000)
        assert page.url.endswith('#studio'), page.locator('#errBox').inner_text()
        expect(page.locator('.mixer-field small')).to_contain_text('就绪', timeout=120000)
        page.get_by_role('button', name='原谱演奏',exact=True).click()
    generate()
    page.get_by_label('显示级数').check()
    current = page.locator('[data-current-chord]')
    mark = page.locator('.follow-system .harmony-labels .current')
    expect(current).to_have_text('Dm7')
    expect(mark).to_have_text('Dm7ii7',timeout=120000)
    page.locator('#playBtn').click()
    expect(current).to_have_text('G7', timeout=6000)
    expect(mark).to_have_text('G7V7')
    page.locator('#playBtn').click()
    tools = page.locator('.harmony-tools').bounding_box()
    roll = page.locator('.roll-card').bounding_box()
    page.screenshot(path=out/'harmony-follow.png', clip={
        'x': roll['x'], 'y': tools['y'], 'width': roll['width'],
        'height': roll['y'] + roll['height'] - tools['y']
    })
    page.wait_for_timeout(350)
    expect(current).to_have_text('G7')
    page.locator('#seekSlider').fill('4.5')
    expect(current).to_have_text('C')
    expect(mark).to_have_text('CI')
    page.locator('#stopBtn').click()
    for track in ['AI 演绎', '琶音还原版']:
        page.get_by_role('button',name=track,exact=True).click()
        page.locator('#playBtn').click()
        expect(current).to_have_text('G7',timeout=15000)
        expect(mark).to_have_text('G7V7')
        page.locator('#stopBtn').click()
    page.get_by_role('button',name='原谱演奏',exact=True).click()
    page.get_by_role('button',name='查看谱面').click()
    overlay = page.locator('.harmony-overlay .current')
    expect(overlay).to_have_text('Dm7ii7')
    page.get_by_role('button',name='播放',exact=True).click()
    expect(overlay).to_have_text('G7V7',timeout=6000)
    expect(overlay).to_have_text('CI',timeout=6000)
    page.get_by_role('button',name='暂停',exact=True).click()
    page.locator('#svgGallery').screenshot(path=out/'harmony-sheet.png')
    page.get_by_label('和声分析').uncheck()
    expect(page.locator('.harmony-overlay')).to_have_count(0)
    page.get_by_label('和声分析').check()
    page.get_by_role('link',name='乐谱编辑').click()
    editor.fill(r'''\version "2.24.3"
harmonyStudyChanges = \chordmode { \repeat volta 2 { f2:maj7 g:7 } c1 }
melody = { \key c \major \tempo 4 = 120 \repeat volta 2 { <c' e' g'>1 } <c' e' g'>1 }
\score { << \new ChordNames \harmonyStudyChanges \new Staff \melody >> \layout {} }
\score { \unfoldRepeats \melody \midi {} }''')
    generate()
    expect(current).to_have_text('Fmaj7')
    expect(page.locator('.harmony-readout')).to_contain_text('原谱标记')
    for seconds, chord in [('1.2','G7'),('2.2','Fmaj7'),('3.2','G7'),('4.2','C')]:
        page.locator('#seekSlider').fill(seconds)
        expect(current).to_have_text(chord)
        expect(page.locator('.harmony-readout')).to_contain_text('原谱标记')
    page.get_by_role('link',name='乐谱编辑').click()
    page.locator('#fileInput').set_input_files({'name':'harmony.musicxml','mimeType':'application/xml',
        'buffer':(xml % (triad('CEG'),triad('GBD'))).encode()})
    generate()
    expect(current).to_have_text('Fmaj7')
    expect(page.locator('.harmony-readout')).to_contain_text('原谱标记')
    page.locator('.locale-select').select_option('en')
    expect(page.locator('.harmony-readout')).to_contain_text('From score')
    expect(page.locator('.harmony-readout')).to_contain_text('Major seventh')
    page.locator('.locale-select').select_option('zh-CN')
    page.locator('#seekSlider').fill('1.7')
    expect(current).to_have_text('G7')
    page.get_by_role('link',name='乐谱编辑').click()
    page.locator('#presetSelect').select_option('sunny_day')
    expect(page.locator('#importedScoreCard')).to_be_visible()
    generate()
    page.get_by_role('button',name='显示 MIDI 随奏谱').click()
    expect(page.locator('.follow-system .harmony-labels text').first).to_be_visible(timeout=120000)
    assert not errors, errors
    (out/'harmony.json').write_text(json.dumps({'inferred':['Dm7','G7','C'], 'degrees':['ii7','V7','I'],
        'tested':['score playback','AI playback','restored playback','pause','seek','sheet playback','layer toggle','English controls','LilyPond chord names and repeats','MusicXML authored chords','MIDI engraving'],
        'pageErrors': errors},indent=2)+'\n')
    browser.close()
