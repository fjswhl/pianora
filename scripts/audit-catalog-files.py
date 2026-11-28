"""Parse each restored score with the actual browser importer and fingerprint its notated pitches."""
import argparse, base64, hashlib, json, os
from pathlib import Path
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('manifest',type=Path)
parser.add_argument('directory',type=Path)
parser.add_argument('--dev-origin',default='http://localhost:5173')
parser.add_argument('--output',required=True,type=Path)
args=parser.parse_args()
report={}
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel=os.getenv('PIANORA_BROWSER','chrome'))
    page=browser.new_page()
    page.goto(args.dev_origin,wait_until='domcontentloaded')
    for score in json.loads(args.manifest.read_text())['scores']:
        data=(args.directory/score['file']).read_bytes()
        digest=hashlib.sha256(data).hexdigest()
        assert digest==score['sha256'],score['id']
        result=page.evaluate('''async ([name,bytes])=>{
          const {parseDirectScoreFile}=await import('/src/engine/scoreImport.ts');
          const buffer=Uint8Array.from(atob(bytes),c=>c.charCodeAt(0));
          const p=await parseDirectScoreFile(new File([buffer],name));
          const notes=p.midi.tracks.flatMap(t=>t.notes).sort((a,b)=>a.ticks-b.ticks || a.midi-b.midi);
          const hash=await crypto.subtle.digest('SHA-256',Uint8Array.from(notes,n=>n.midi));
          return {notes:p.noteCount,seconds:p.durationSec,format:p.kind,
               pitchHash:Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')};
        }''',[score['file'].split('/')[-1],base64.b64encode(data).decode()])
        assert result['notes']>0 and result['seconds']>0,score['id']
        report[score['id']]={**result,'sha256':digest}
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(report,indent=2)+'\n')
print('Verified',len(report),'scores in the browser')
