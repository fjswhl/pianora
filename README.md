# Pianora 琴境

> **Turn sheet music into living grand piano performances — 100% locally in your browser.**
> 让静态乐谱拥有钢琴家的呼吸与音乐厅灵魂：100% 纯前端零后端，端到端浏览器内完成制谱、AI 演奏演绎、交互指挥与真实三角钢琴声学渲染。

---

## Core Architecture (5-Stage Pure-Browser Pipeline)

1. **Stage 1 · In-Browser Sheet Music Compilation (`@sightread/lilypond-wasm`)**
   Compiles LilyPond (`.ly`) scores directly inside a browser WebAssembly Worker into crisp SVG sheet music + exact score MIDI, with built-in Mutopia/2.18 compatibility sanitization.
2. **Stage 2 · Symbolic Ornament Extraction (Scheme Engraver)**
   Injects a custom LilyPond Scheme Engraver (`Demo_arpeggio_collector_engraver`) to extract exact symbolic moments (such as `\arpeggio`) that standard MIDI drops.
3. **Stage 3 · Expressive Flow Matching AI Pianist (`SyMuPe/PianoFlow-base` ONNX on WebGPU/WASM)**
   Runs Conditional Flow Matching directly on browser WebGPU (with automatic WASM fallback) using a bit-exact pure-TypeScript `SyMuPe` tokenizer.
4. **Stage 4 · Symbolic Precision Restoration**
   Restores rolled arpeggios bottom-to-top while preserving 100% of the AI pianist's rubato, dynamics, and voicing — with real-time slider retuning (< 1 ms).
5. **Stage 5 · Studio Acoustic Grand Piano Engine (Pure Web Audio + AudioWorklet)**
   - **5-Velocity-Layer Yamaha C5 (Salamander)** fast-start engine + **SpessaSynth AudioWorklet** SoundFont2 engine (`620 MB Full Salamander C5`, `Abbey Steinway D`, `Nice Steinway v3.8`, `Dore Mark Fazioli F308`, plus local `.sf2/.sf3/.dls` import)
   - **Custom AudioWorklet Sympathetic String & Soundboard Resonance** (`public/audio/sympathetic_resonance.js`): 28-mode damped harmonic resonator bank with realistic string inharmonicity + 4-line diffused spruce soundboard body halo
   - **Real Concert Hall Convolution Reverb (`ConvolverNode`)**: Vienna Musikverein, 18th-Century French Salon, La Scala Opera Hall, St. Nicolaes Church
   - **Sample-Accurate Offline WAV Export**: renders through the exact same sympathetic resonance + hall convolution chain via `OfflineAudioContext`.

---

## 7 Interactive AI Pianist Modes

- **① Batch Blind-Box Gacha (`批量盲盒抽卡`)**: Generate 2–8 distinct takes with tunable `cfmSteps`, `cfmStepFactor`, and seeds into an A/B Takes Pool.
- **② Prefix-Lock Continuation (`锁前半段续弹`)**: Freeze bars `1..K` verbatim as conditioning context and regenerate fresh continuations for the rest.
- **③ Bidirectional Local Inpainting (`局部挖空重弹`)**: Lock both opening and ending, repaint only bars `A..B` with a centered bidirectional Flow Matching window.
- **④ Per-Dimension Selective Resampling (`拆维度精修`)**: Independently resample **Velocity**, **Timing/Rubato**, **Touch Duration**, or **Sustain Pedal** while locking all other dimensions.
- **⑤ Conductor Timeline (`分段指挥家`)**: Set bar-by-bar tempo & dynamics cues applied via Guided Flow Matching ODE endpoint steering.
- **⑥ Real-Time Live Sliding-Window Conductor (`边放边拖实时指挥`)**: 0.25s lookahead engine on WebGPU — drag Tempo/Dynamics sliders mid-playback to drop unplayed cache and steer expression within ~60–150 ms.
- **⑦ Master Style Relay (`大师风格接力`)**: Align any human pianist's `.mid` recording onto the opening `K` bars via pure-TS Dynamic Programming, lock their touch/rubato/pedaling, and let PianoFlow continue the entire piece in their style.

---

## Quick Start

```bash
# 1. Install dependencies & copy browser WASM/AudioWorklet runtimes
npm install
npm run setup:runtime

# 2. (Optional) Download curated studio concert grand SF2 soundfonts (~1.1 GB total)
#    Note: The default 5-velocity-layer Yamaha C5 works out of the box with zero local SF2 files!
npm run setup:soundfonts

# 3. Export SyMuPe/PianoFlow-base to public/models/pianoflow_step_fp32.onnx
#    (requires Python + symupe + onnxruntime, see scripts/export_pianoflow_onnx.py)
python scripts/export_pianoflow_onnx.py

# 4. Run dev server or production build
npm run dev
# or
npm run build && npm run preview
```

---

## Credits & Open-Source Assets

- Expressive performance model: [SyMuPe / PianoFlow-base](https://huggingface.co/SyMuPe/PianoFlow-base)
- Browser LilyPond compiler: [@sightread/lilypond-wasm](https://www.npmjs.com/package/@sightread/lilypond-wasm)
- Browser SoundFont2 AudioWorklet: [SpessaSynth](https://github.com/spessasus/spessasynth_lib)
- Acoustic piano samples: Salamander Grand Piano v3 (Alexander Holm, CC-BY-3.0) & Soundfonts4U
- Measured acoustic hall impulse responses: Voxengo Free Impulse Responses via `oramics/sampled`
