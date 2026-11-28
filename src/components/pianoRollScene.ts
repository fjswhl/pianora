import type { Midi } from '@tonejs/midi';
import type { SimpleNote } from '../engine/arpeggio';
import { scoreToPerformanceTime } from '../engine/performanceClock';

// Interpolate the performed beat from the score tempo map and this take's onsets.
// Sample rubato at quarter-note boundaries so a rolled chord cannot shake the camera.
function performedBeat(midi: Midi, notes: SimpleNote[]) {
  const { header } = midi;
  const ticks = new Set([0, ...header.tempos.map(t => t.ticks)]);
  for (const n of notes) {
    if (n.scoreTime !== undefined)
      ticks.add(Math.floor(header.secondsToTicks(n.scoreTime) / header.ppq) * header.ppq);
  }
  const ordered = [...ticks].sort((a, b) => a - b);
  ordered.push(ordered[ordered.length - 1] + header.ppq);
  const playbackTime = scoreToPerformanceTime(notes);
  const anchors: { sec: number; beat: number }[] = [];
  for (const tick of ordered) {
    const sec = playbackTime(header.ticksToSeconds(tick));
    if (!anchors.length || sec > anchors[anchors.length - 1].sec)
      anchors.push({ sec, beat: tick / header.ppq });
  }
  return (sec: number) => {
    let lo = 0, hi = anchors.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (anchors[mid].sec <= sec) lo = mid;
      else hi = mid;
    }
    const a = anchors[lo], b = anchors[hi];
    return a === b ? a.beat : a.beat + (sec - a.sec) * (b.beat - a.beat) / (b.sec - a.sec);
  };
}

const blackNotes = [false, true, false, true, false, false, true, false, true, false, true, false];
let whites = 0;
const keys = Array.from({ length: 88 }, (_, i) => {
  const pitch = i + 21;
  const black = blackNotes[pitch % 12];
  return { pitch, black, center: black ? whites : whites++ + 0.5 };
});

// Ink on paper: soft notes are pale graphite, loud notes are near-black.
// The red pencil marks only what is sounding now.
const inks = Array.from({ length: 128 }, (_, v) => `rgba(17,17,17,${(0.22 + 0.72 * v / 127).toFixed(3)})`);
const pencil = '#c8361f';

export function prepareRoll(midi: Midi, notes: SimpleNote[]) {
  const beat = performedBeat(midi, notes);
  const sorted = notes.filter(n => n.p >= 21 && n.p <= 108).sort((a, b) => a.s - b.s);
  let latest = -Infinity;
  const bars = sorted.map(n => {
    latest = Math.max(latest, n.s + n.d);
    return { n, start: beat(n.s), end: beat(n.s + n.d), latest };
  });
  return { beat, bars };
}

type Scene = ReturnType<typeof prepareRoll>;
const visibleBeats = 7;
const release = 0.28;

export function drawRoll(ctx: CanvasRenderingContext2D, w: number, h: number,
  scene: Scene | undefined, now: number, reduced: boolean) {
  const keyboard = Math.min(48, Math.round(h * 0.24));
  const rail = h - keyboard;
  const keyW = w / whites;
  const pos = scene?.beat(now) ?? 0;
  const px = rail / visibleBeats;
  const gradient = (top: number, bottom: number, a: string, b: string) => {
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    return g;
  };
  ctx.fillStyle = '#faf9f6';
  ctx.fillRect(0, 0, w, rail);
  for (const k of keys) {
    if (k.pitch % 12 !== 0) continue;
    ctx.fillStyle = 'rgba(17,17,17,.06)';
    ctx.fillRect((k.center - 0.5) * keyW, 0, 1, rail);
  }
  for (let i = Math.ceil(pos); i < pos + visibleBeats; i++) {
    ctx.fillStyle = 'rgba(17,17,17,.05)';
    ctx.fillRect(0, rail - (i - pos) * px, w, 1);
  }

  const pressed = new Float32Array(88);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, rail);
  ctx.clip();
  if (scene) {
    const { bars } = scene;
    let lo = 0, hi = bars.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (bars[mid].latest < now - release) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < bars.length; i++) {
      const { n, start, end } = bars[i];
      if (start > pos + visibleBeats) break;
      const age = now - n.s;
      if (age > n.d + release) continue;
      const idx = n.p - 21, key = keys[idx];
      const v = Math.max(1, Math.min(127, Math.round(n.v)));
      const force = v / 127;
      const x = key.center * keyW;
      const width = Math.max(2, keyW * (0.29 + 0.53 * force) * (key.black ? 0.8 : 1));
      const bottom = rail - (start - pos) * px;
      const top = Math.max(-6, Math.min(bottom - 3, rail - (end - pos) * px));
      if (age <= n.d) {
        const base = Math.min(rail + width, bottom);
        ctx.fillStyle = age >= 0 ? pencil : inks[v];
        ctx.beginPath();
        ctx.roundRect(x - width / 2, top, width, Math.max(3, base - top), Math.min(width * 0.32, 2));
        ctx.fill();
      }
      if (age < 0) continue;
      const fade = Math.max(0, 1 - Math.max(0, age - n.d) / release);
      const pressure = (0.2 + force * 0.8) * fade;
      if (pressure >= pressed[idx]) pressed[idx] = pressure;

      if (!reduced && age < release) {
        const progress = age / release;
        const radius = (6 + keyW * (0.8 + force)) * (0.65 + progress);
        const bloom = ctx.createRadialGradient(x, rail, 0, x, rail, radius);
        bloom.addColorStop(0, 'rgba(200,54,31,.55)');
        bloom.addColorStop(1, 'transparent');
        ctx.globalAlpha = (1 - progress) ** 2 * force * 0.85;
        ctx.fillStyle = bloom;
        ctx.fillRect(x - radius, rail - radius, radius * 2, radius);
        ctx.globalAlpha = 1;
        if (v >= 90) {
          ctx.fillStyle = pencil;
          ctx.globalAlpha = (1 - progress) * force;
          for (const dir of [-1, 0, 1]) {
            const spread = dir * keyW * progress * 0.9;
            const rise = (12 + 22 * force) * progress * (1 - Math.abs(dir) * 0.32);
            ctx.fillRect(x + spread, rail - rise - 1, 1.3, 2.6);
          }
          ctx.globalAlpha = 1;
        }
      }
    }
  }
  if (!reduced) {
    // Pool the light around sounding keys, with one reflection per pitch even for overlapping voices.
    for (let i = 0; i < pressed.length; i++) {
      const pressure = pressed[i];
      if (!pressure) continue;
      const x = keys[i].center * keyW;
      const radius = Math.max(6, keyW * (1.2 + 2.2 * pressure));
      const light = ctx.createRadialGradient(x, rail, 0, x, rail, radius);
      light.addColorStop(0, 'rgba(200,54,31,.35)');
      light.addColorStop(1, 'transparent');
      ctx.globalAlpha = pressure * 0.52;
      ctx.fillStyle = light;
      ctx.fillRect(x - radius, rail - radius, 2 * radius, radius);
    }
  }
  ctx.restore();

  const ivory = gradient(rail, h, '#ffffff', '#f1efe9');
  const ebony = gradient(rail, rail + keyboard * 0.62, '#1b1b1b', '#3a3a3a');
  ctx.fillStyle = '#d6d2c9';
  ctx.fillRect(0, rail, w, keyboard);
  for (const black of [false, true]) {
    for (const [i, k] of keys.entries()) {
      if (k.black !== black) continue;
      const pressure = pressed[i];
      const width = black ? keyW * 0.62 : keyW - 0.7;
      const x = k.center * keyW - width / 2;
      const depth = keyboard * (black ? 0.62 : 1) - 1 - pressure * 2;
      ctx.fillStyle = black ? ebony : ivory;
      ctx.fillRect(x, rail, width, depth);
      if (pressure) {
        ctx.globalAlpha = Math.min(1, 0.88 * pressure);
        ctx.fillStyle = pencil;
        ctx.fillRect(x, rail, width, depth);
        ctx.globalAlpha = 1;
        ctx.fillStyle = pencil;
        ctx.fillRect(x, rail, width, 1.5 + pressure * 2);
      }
      ctx.fillStyle = black ? '#555' : '#ffffff';
      ctx.fillRect(x + 1, rail + depth - 2, Math.max(1, width - 2), 1);
      if (k.pitch % 12 === 0 && w > 600) {
        ctx.fillStyle = '#75726b';
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText('C' + (k.pitch / 12 - 1), x + 1, h - 5);
      }
    }
  }
  ctx.fillStyle = '#d6d2c9';
  ctx.fillRect(0, rail - 1, w, 1);
}
