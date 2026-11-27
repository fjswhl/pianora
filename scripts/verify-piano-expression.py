"""Verify visual dynamics and tempo through MIDI import, track selection and playback.
Uses ffmpeg to save a silent preview of actual playback alongside the pixel measurements.
"""
import base64
import json
import os
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
output = Path(os.getenv("PIANORA_ARTIFACTS", root / "artifacts"))
output.mkdir(parents=True, exist_ok=True)
fixture = """
const {Midi} = require('@tonejs/midi');
const midi = new Midi(), beat = midi.header.ppq, track = midi.addTrack();
midi.header.tempos = [{ticks:0, bpm:60}, {ticks:8*beat, bpm:120}];
midi.header.update();
const add = (p,b,len,v) => track.addNote({midi:p,ticks:b*beat,durationTicks:len*beat,velocity:v/127});
for (let b=0;b<18;b++) {
  const v = Math.min(116, 35 + Math.max(0,b-3)*12);
  add([45,48,50,43][Math.floor(b/2)%4],b,0.8,v);
  for(let i=0;i<4;i++) add([64,67,71,74,76,71,69,67][(4*b+i)%8],b+i/4,0.2,v);
}
add(60,3,0.6,32); add(60,11,0.6,118);
require('node:fs').writeFileSync(process.argv[1],midi.toArray());
"""

with tempfile.TemporaryDirectory() as tmp, sync_playwright() as pw:
    file = Path(tmp) / "Dynamics and tempo.mid"
    subprocess.run(["node", "-e", fixture, str(file)], cwd=root, check=True)
    browser = pw.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chrome"))
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.goto(os.getenv("PIANORA_URL", "http://127.0.0.1:4173"))
    with page.expect_file_chooser() as picker:
        page.get_by_role("button", name="导入乐谱").click()
    picker.value.set_files(file)
    page.locator("summary").first.click()
    page.locator("#cfmSteps").fill("4")
    page.locator("#renderBtn").click()
    page.wait_for_url("**/#studio", timeout=180000)
    expect(page.locator(".mixer-field small")).to_contain_text("就绪", timeout=60000)
    page.get_by_role("button", name="原谱演奏", exact=True).click()
    canvas = page.locator("#pianoCanvas")
    seek = page.locator("#seekSlider")

    def jump(t):
        seek.fill(str(t))
        page.evaluate("new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))")

    # Find the visible end and body width of the next middle C in canvas pixels.
    def ribbon(t):
        jump(t)
        return canvas.evaluate("""c => {
          const {width:w,height:h}=c;
          const data=c.getContext('2d').getImageData(0,0,w,h).data;
          const whites=Array.from({length:39},(_,i)=>i+21).filter(p=>![1,3,6,8,10].includes(p%12)).length;
          const x=Math.floor((whites+.5)*w/52);
          const rail=h-Math.min(48,Math.round(h*.24));
          const bright=(x,y)=>data[(y*w+x)*4+1]>102;
          let y=rail-6;
          while(y>0 && !bright(x,y)) y--;
          if (!y) throw Error('Middle C ribbon not found');
          let left=x, right=x;
          while(left>0 && bright(left-1,y-3)) left--;
          while(right<w-1 && bright(right+1,y-3)) right++;
          return {y,width:right-left+1};
        }""")

    quiet, slow = ribbon(2), ribbon(2.2)
    loud, fast = ribbon(9), ribbon(9.2)
    dy_slow, dy_fast = slow["y"]-quiet["y"], fast["y"]-loud["y"]
    assert dy_slow > 0 and 1.6 <= dy_fast/dy_slow <= 2.5, (quiet, slow, loud, fast)
    assert loud["width"] >= quiet["width"]+2, (quiet, loud)
    jump(9.6)
    regular = canvas.evaluate("c=>c.toDataURL()")
    page.get_by_role("button", name="AI 演绎", exact=True).click()
    page.wait_for_function("s=>document.querySelector('#pianoCanvas').toDataURL()!==s", arg=regular)
    page.get_by_role("button", name="原谱演奏", exact=True).click()
    page.wait_for_function("s=>document.querySelector('#pianoCanvas').toDataURL()===s", arg=regular)
    page.emulate_media(reduced_motion="reduce")
    page.wait_for_function("s=>document.querySelector('#pianoCanvas').toDataURL()!==s", arg=regular)
    page.emulate_media(reduced_motion="no-preference")
    jump(5.8)
    # Record the actual player's animation across the crescendo and tempo change.
    canvas.evaluate("""c=>{
      const stream=c.captureStream(24), rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});
      const chunks=[];
      rec.ondataavailable=e=>chunks.push(e.data);
      window.clip=new Promise(resolve=>{rec.onstop=()=>{
        const reader=new FileReader();reader.onload=()=>resolve(reader.result);
        reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));
        stream.getTracks().forEach(t=>t.stop());
      }});
      window.finishClip=()=>rec.stop(); rec.start();
    }""")
    page.locator("#playBtn").click()
    expect(page.locator("#playBtn")).to_have_text("暂停")
    page.wait_for_timeout(4600)
    page.locator("#playBtn").click()
    clip = page.evaluate("() => {finishClip();return clip}")
    video = Path(tmp) / "playback.webm"
    video.write_bytes(base64.b64decode(clip.split(",")[1]))
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(video), "-filter_complex",
                    "fps=20,scale=720:-1,split[a][b];[a]palettegen[p];[b][p]paletteuse",
                    str(output / "piano-expression.gif")], check=True)
    still = canvas.evaluate("c=>c.toDataURL()")
    page.wait_for_timeout(200)
    assert canvas.evaluate("c=>c.toDataURL()") == still
    page.set_viewport_size({"width":390,"height":844})
    jump(9.6)
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
    canvas.screenshot(path=output / "piano-expression-mobile.png")
    browser.close()

report = {"noteWidthPx":{"velocity32":quiet["width"],"velocity118":loud["width"]},
          "travelIn200msPx":{"bpm60":dy_slow,"bpm120":dy_fast}}
(output/"piano-expression.json").write_text(json.dumps(report, indent=2)+"\n")
print(report)
