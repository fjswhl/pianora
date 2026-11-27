/**
 * Pure Web AudioWorkletProcessor: Piano Sympathetic String & Soundboard Resonance
 *
 * Physically models two acoustic grand-piano phenomena missing from standard samplers:
 * 1. Sympathetic String Resonance:
 *    Maintains a pool of damped harmonic resonators tuned to currently undamped strings
 *    (held keys + sustain pedal) with piano string inharmonicity B_k. When new notes strike,
 *    harmonically related open strings (octaves, 5ths, 12ths, 15ths, 17ths) are coupled and
 *    ring out organically, then damp cleanly (~55 ms velvet felt decay) on key/pedal release.
 * 2. Soundboard & Open-String Pedal Halo:
 *    A warm low-passed 4-line stereo acoustic body diffuser whose energy scales smoothly
 *    with the number of currently undamped strings / pedal state.
 *
 * Outputs WET-ONLY stereo resonance so dry direct sound stays 100% phase-clean and latency-free.
 * Supports both real-time messages (noteOn/noteOff/pedal/reset) and sample-accurate offline
 * event timelines (scheduleEvents) for identical OfflineAudioContext WAV rendering.
 */

const MAX_SLOTS = 28;

// Strong sympathetic intervals in semitones: unison, 5th, octave, 12th, 2-oct, 17th, 19th, 3-oct
const SYMPATHETIC_INTERVALS = new Map([
  [12, 1.0],
  [19, 0.72],
  [24, 0.62],
  [7, 0.48],
  [28, 0.42],
  [31, 0.36],
  [36, 0.3],
  [5, 0.34],
]);

function midiToFreq(midi, harmonic = 1) {
  const f0 = 440.0 * Math.pow(2, (midi - 69) / 12);
  // Subtle realistic grand-piano string inharmonicity coefficient B(midi)
  const B = 0.00004 * Math.pow(2, (midi - 48) / 18);
  return f0 * harmonic * Math.sqrt(1.0 + B * harmonic * harmonic);
}

class SympatheticResonanceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate || 44100;
    this.sr = sr;
    this.heldKeys = new Uint8Array(128);
    this.openCount = 0;
    this.pedalDown = false;
    this.samplePos = 0;

    // Scheduled offline events: [{ frame, type, midi, vel, down }]
    this.scheduled = [];
    this.schedIdx = 0;

    // 28 damped 2nd-order harmonic string resonators
    this.slots = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      this.slots.push({
        active: false,
        midi: -1,
        freq: 440,
        y1: 0,
        y2: 0,
        a1: 0,
        a2: 0,
        g: 0,
        rOpen: 0.9996,
        rDamp: Math.exp(-1.0 / (0.055 * sr)),
        cosW: 0,
        sinW: 0,
        amp: 0,
        panL: 0.707,
        panR: 0.707,
        damped: true,
        age: 0,
      });
    }
    this.tickCounter = 0;

    // 4-line warm soundboard / open-string body resonance diffuser
    const delayMs = [11.3, 15.7, 21.1, 27.9];
    this.bodyLines = delayMs.map((ms) => {
      const len = Math.max(32, Math.round((ms * sr) / 1000));
      return { buf: new Float32Array(len), idx: 0, lp: 0, len };
    });
    this.bloomEnv = 0;
    this.inputLpL = 0;
    this.inputLpR = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'noteOn') {
        this.handleNoteOn(msg.midi | 0, msg.vel ?? 80);
      } else if (msg.type === 'noteOff') {
        this.handleNoteOff(msg.midi | 0);
      } else if (msg.type === 'pedal') {
        this.handlePedal(Boolean(msg.down));
      } else if (msg.type === 'reset') {
        this.resetState();
      } else if (msg.type === 'scheduleEvents' && Array.isArray(msg.events)) {
        this.resetState();
        this.scheduled = msg.events;
        this.schedIdx = 0;
      }
    };
  }

  resetState() {
    this.heldKeys.fill(0);
    this.openCount = 0;
    this.pedalDown = false;
    this.samplePos = 0;
    this.scheduled = [];
    this.schedIdx = 0;
    this.bloomEnv = 0;
    this.inputLpL = 0;
    this.inputLpR = 0;
    for (const s of this.slots) {
      s.active = false;
      s.midi = -1;
      s.y1 = 0;
      s.y2 = 0;
      s.damped = true;
    }
    for (const b of this.bodyLines) {
      b.buf.fill(0);
      b.idx = 0;
      b.lp = 0;
    }
  }

  allocateSlot(ownerMidi, targetFreq, strength) {
    if (targetFreq < 30 || targetFreq > this.sr * 0.38) return;

    // Reuse existing slot if same ownerMidi & close frequency
    let slot = null;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = this.slots[i];
      if (s.active && s.midi === ownerMidi && Math.abs(s.freq - targetFreq) < 1.5) {
        slot = s;
        break;
      }
    }
    if (!slot) {
      // Find inactive slot or quietest / oldest slot
      let bestScore = Infinity;
      for (let i = 0; i < MAX_SLOTS; i++) {
        const s = this.slots[i];
        if (!s.active) {
          slot = s;
          break;
        }
        const energy = Math.abs(s.y1) + Math.abs(s.y2);
        const score = (s.damped ? 0.05 : 1.0) * (energy + 1e-4) - (this.tickCounter - s.age) * 1e-6;
        if (score < bestScore) {
          bestScore = score;
          slot = s;
        }
      }
    }

    const w = (2.0 * Math.PI * targetFreq) / this.sr;
    // Lower strings ring longer (~2.9s), upper strings decay faster (~0.85s)
    const pitchNorm = Math.max(0, Math.min(1, (ownerMidi - 21) / 87));
    const tauOpen = 2.9 - 2.0 * pitchNorm;
    const rOpen = Math.min(0.99992, Math.exp(-1.0 / (tauOpen * this.sr)));

    const isReuse = slot.active && slot.midi === ownerMidi && Math.abs(slot.freq - targetFreq) < 1.5;
    slot.active = true;
    slot.midi = ownerMidi;
    slot.freq = targetFreq;
    slot.cosW = Math.cos(w);
    slot.sinW = Math.sin(w);
    slot.rOpen = rOpen;
    slot.damped = false;
    slot.amp = Math.min(1.0, isReuse ? Math.max(slot.amp, strength) : strength);
    slot.age = ++this.tickCounter;

    // Apply open-damper coefficients
    slot.a1 = 2.0 * rOpen * slot.cosW;
    slot.a2 = -(rOpen * rOpen);
    // Normalized resonant gain (unity peak gain * coupling strength)
    slot.g = (1.0 - rOpen) * slot.sinW * (0.28 * slot.amp);

    if (!isReuse) {
      slot.y1 = 0;
      slot.y2 = 0;
    }

    // Natural pianist-perspective stereo pan (bass left -> treble right)
    const pan = Math.max(-0.75, Math.min(0.75, (ownerMidi - 60) / 48));
    const angle = (pan + 1.0) * 0.25 * Math.PI;
    slot.panL = Math.cos(angle);
    slot.panR = Math.sin(angle);
  }

  dampKeySlots(midi) {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = this.slots[i];
      if (s.active && s.midi === midi && !s.damped) {
        s.damped = true;
        const r = s.rDamp;
        s.a1 = 2.0 * r * s.cosW;
        s.a2 = -(r * r);
        s.g = 0;
      }
    }
  }

  handleNoteOn(midi, vel) {
    if (midi < 21 || midi > 108) return;
    if (!this.heldKeys[midi]) {
      this.heldKeys[midi] = 1;
      this.openCount++;
    }
    const velFactor = Math.max(0.18, Math.min(1.0, vel / 110));

    // 1. Excite all OTHER currently undamped keys that share harmonic overtones with this strike
    let coupledCount = 0;
    for (let u = 21; u <= 108; u++) {
      if (u === midi || !this.heldKeys[u]) continue;
      const diff = Math.abs(u - midi);
      const weight = SYMPATHETIC_INTERVALS.get(diff);
      if (weight) {
        // Excite the higher string's fundamental (or shared overtone)
        const sharedFreq = u > midi ? midiToFreq(u, 1) : midiToFreq(midi, 1);
        this.allocateSlot(u, sharedFreq, weight * velFactor * 0.95);
        coupledCount++;
        if (coupledCount >= 6) break;
      }
    }

    // 2. When sustain pedal is down OR >= 2 strings are open (polyphonic legato/chords),
    //    excite natural sympathetic upper partials (octave & 12th) and bass duplex glow
    if (this.pedalDown || this.openCount >= 2) {
      const pedBoost = this.pedalDown ? 1.0 : 0.65;
      if (midi + 12 <= 104) {
        this.allocateSlot(midi, midiToFreq(midi, 2), 0.52 * velFactor * pedBoost);
      }
      if (midi + 19 <= 106 && midi >= 33) {
        this.allocateSlot(midi, midiToFreq(midi, 3), 0.30 * velFactor * pedBoost);
      }
      if (midi - 12 >= 24 && midi <= 76) {
        // Bass string sympathizes at 2nd partial (= struck pitch)
        this.allocateSlot(midi - 12, midiToFreq(midi, 1), 0.38 * velFactor * pedBoost);
      }
    }
  }

  handleNoteOff(midi) {
    if (midi < 21 || midi > 108) return;
    if (this.heldKeys[midi]) {
      this.heldKeys[midi] = 0;
      this.openCount = Math.max(0, this.openCount - 1);
    }
    if (!this.pedalDown) {
      this.dampKeySlots(midi);
    }
  }

  handlePedal(down) {
    this.pedalDown = down;
    if (!down) {
      for (let i = 0; i < MAX_SLOTS; i++) {
        const s = this.slots[i];
        if (s.active && !s.damped && s.midi >= 21 && !this.heldKeys[s.midi]) {
          s.damped = true;
          const r = s.rDamp;
          s.a1 = 2.0 * r * s.cosW;
          s.a2 = -(r * r);
          s.g = 0;
        }
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output[1] || outL;
    const n = outL.length;

    // Trigger any sample-accurate offline scheduled events inside this render quantum
    const blockEnd = this.samplePos + n;
    while (this.schedIdx < this.scheduled.length && this.scheduled[this.schedIdx].frame < blockEnd) {
      const ev = this.scheduled[this.schedIdx++];
      if (ev.type === 'noteOn') this.handleNoteOn(ev.midi, ev.vel);
      else if (ev.type === 'noteOff') this.handleNoteOff(ev.midi);
      else if (ev.type === 'pedal') this.handlePedal(ev.down);
    }
    this.samplePos = blockEnd;

    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;

    // Smooth soundboard bloom envelope based on open strings / sustain pedal
    const targetBloom = this.pedalDown ? 1.0 : Math.min(0.85, this.openCount * 0.16);
    const bloomCoeff = targetBloom > this.bloomEnv ? 0.0025 : 0.0008;

    // Pre-collect active slots for tight inner loop
    let activeCount = 0;
    const activeSlots = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      if (s.damped && Math.abs(s.y1) + Math.abs(s.y2) < 1e-6) {
        s.active = false;
        s.y1 = 0;
        s.y2 = 0;
        continue;
      }
      activeSlots[activeCount++] = s;
    }

    const b0 = this.bodyLines[0];
    const b1 = this.bodyLines[1];
    const b2 = this.bodyLines[2];
    const b3 = this.bodyLines[3];

    for (let i = 0; i < n; i++) {
      const xL = inL ? inL[i] : 0;
      const xR = inR ? inR[i] : 0;
      const xMono = 0.5 * (xL + xR);

      // Gentle 1-pole pre-filter (~2.4 kHz) for realistic wooden soundboard & string excitation
      this.inputLpL += 0.28 * (xL - this.inputLpL);
      this.inputLpR += 0.28 * (xR - this.inputLpR);
      const exc = 0.5 * (this.inputLpL + this.inputLpR);

      let resL = 0;
      let resR = 0;

      // 1. Sum sympathetic harmonic string resonators
      for (let k = 0; k < activeCount; k++) {
        const s = activeSlots[k];
        const y = s.g * exc + s.a1 * s.y1 + s.a2 * s.y2;
        s.y2 = s.y1;
        s.y1 = y;
        resL += y * s.panL;
        resR += y * s.panR;
      }

      // 2. Warm soundboard / open-string pedal halo (4-line diffused feedback)
      this.bloomEnv += bloomCoeff * (targetBloom - this.bloomEnv);
      const fb = 0.42 + 0.28 * this.bloomEnv;

      const d0 = b0.buf[b0.idx];
      const d1 = b1.buf[b1.idx];
      const d2 = b2.buf[b2.idx];
      const d3 = b3.buf[b3.idx];

      // Lowpass each feedback line (~1.6 kHz) so it sounds like warm spruce wood, never metallic
      b0.lp += 0.20 * (d0 - b0.lp);
      b1.lp += 0.20 * (d1 - b1.lp);
      b2.lp += 0.18 * (d2 - b2.lp);
      b3.lp += 0.18 * (d3 - b3.lp);

      // Householder-style orthogonal mixing feedback matrix (energy-preserving & lush)
      const avg = 0.5 * (b0.lp + b1.lp + b2.lp + b3.lp);
      b0.buf[b0.idx] = xMono * 0.14 + fb * (avg - b0.lp);
      b1.buf[b1.idx] = xMono * 0.14 + fb * (avg - b1.lp);
      b2.buf[b2.idx] = xL * 0.14 + fb * (avg - b2.lp);
      b3.buf[b3.idx] = xR * 0.14 + fb * (avg - b3.lp);

      if (++b0.idx >= b0.len) b0.idx = 0;
      if (++b1.idx >= b1.len) b1.idx = 0;
      if (++b2.idx >= b2.len) b2.idx = 0;
      if (++b3.idx >= b3.len) b3.idx = 0;

      const bodyL = (b0.lp - b1.lp + b2.lp) * 0.24 * this.bloomEnv;
      const bodyR = (b0.lp + b1.lp + b3.lp) * 0.24 * this.bloomEnv;

      // Soft-clip safeguard so resonance can never clip even in dense fff arpeggios
      outL[i] = Math.tanh(resL * 1.35 + bodyL);
      outR[i] = Math.tanh(resR * 1.35 + bodyR);
    }

    return true;
  }
}

registerProcessor('sympathetic-resonance-processor', SympatheticResonanceProcessor);
