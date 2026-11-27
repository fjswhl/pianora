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
   - **5-Velocity-Layer Yamaha C5 (Salamander)** fast-start engine + **SpessaSynth AudioWorklet** SoundFont2 engine (`Abbey Steinway D`, `Nice Steinway v3.8`, `Dore Mark Fazioli F308`, plus local `.sf2/.sf3/.dls` import)
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
#    The default timbre (Abbey Steinway D, 38 MB) needs at least: npm run setup:soundfonts abbey
npm run setup:soundfonts

# 3. Export SyMuPe/PianoFlow-base to public/models/pianoflow_step_fp32.onnx
#    (requires Python + symupe + onnxruntime, see scripts/export_pianoflow_onnx.py)
python scripts/export_pianoflow_onnx.py

# 4. Run dev server or production build
npm run dev
# or
npm run build && npm run preview
```

## Deployment (Cloudflare Workers + R2)

Production runs as a single Cloudflare Worker on **https://opuslin.uk** (`wrangler.jsonc` → `routes[].custom_domain`).

| Payload | Served from |
| --- | --- |
| UI bundle, IRs, small runtime files (≤ 25 MiB each) | Workers Static Assets (`dist/`) |
| ONNX model, ORT WASM, SF2 SoundFonts | R2 bucket `pianora-assets`, streamed by `worker/index.ts` with full `Range` support |

```bash
# Deploy UI + Worker + custom domain (R2 objects are unchanged by redeploys)
npm run deploy

# One-time: upload the large binaries. ALWAYS pass --remote,
# otherwise wrangler 4 writes them to local .wrangler/state instead!
npx wrangler r2 object put pianora-assets/models/pianoflow_step_fp32.onnx \
  --file public/models/pianoflow_step_fp32.onnx \
  --content-type application/octet-stream --remote
```

`public/.assetsignore` keeps the oversized binaries out of the static asset manifest, and
`run_worker_first` routes `/soundfonts/*`, `/models/*`, `/ort/*` through the Worker so R2
stays same-origin (no CORS, no Hugging Face dependency at runtime). Note that R2's
single-PUT limit is 300 MiB — anything larger must be split before upload.

### Continuous deployment (GitHub Actions)

`.github/workflows/deploy.yml` builds and deploys on every push to `main` (also manually via
`workflow_dispatch`). It restores the gitignored runtime files with `npm run setup:runtime`,
typechecks, builds, then runs `wrangler deploy`. R2 objects are untouched by CI.

Required repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token using the **Edit Cloudflare Workers** template, scoped to zone `opuslin.uk` |
| `CLOUDFLARE_ACCOUNT_ID` | `01f3df81c128766bf8244570b541f131` |

---

## Project Architecture

Built with **React 19 + TypeScript + Vite + Tailwind CSS v4 + Zustand + Lucide Icons**, with a strict 3-layer separation keeping all audio, AI inference, and WASM engines 100% framework-agnostic:

```text
src/
├── engine/                 # Framework-agnostic pure TypeScript engines
│   ├── lilypond.ts         # Browser LilyPond WASM compiler + crash auto-recovery
│   ├── arpeggio.ts         # Scheme engraver hook + Mutopia sanitizer + arpeggio restoration
│   ├── pianoflow.ts        # WebGPU/WASM Flow Matching + all 7 modes + DP MIDI aligner
│   ├── pianoAudio.ts       # 5-layer Salamander + SpessaSynth SF2 + Sympathetic Worklet + Hall IR
│   ├── presets.ts          # Built-in score presets
│   └── instances.ts        # Shared engine singletons (60fps canvas reads without React re-renders)
├── store/
│   └── useStudioStore.ts   # Zustand global studio state & actions
└── components/             # Modular Studio UI
    ├── TopBar.tsx
    ├── ScoreSidebar.tsx
    ├── PipelineHeader.tsx
    ├── TransportBar.tsx
    ├── PianoRollCanvas.tsx
    ├── WorkbenchPanel.tsx
    └── SheetMusicPanel.tsx
```

---

## Credits & Open-Source Assets

- Expressive performance model: [SyMuPe / PianoFlow-base](https://huggingface.co/SyMuPe/PianoFlow-base)
- Browser LilyPond compiler: [@sightread/lilypond-wasm](https://www.npmjs.com/package/@sightread/lilypond-wasm)
- Browser SoundFont2 AudioWorklet: [SpessaSynth](https://github.com/spessasus/spessasynth_lib)
- Acoustic piano samples: Salamander Grand Piano v3 (Alexander Holm, CC-BY-3.0) & Soundfonts4U
- Measured acoustic hall impulse responses: Voxengo Free Impulse Responses via `oramics/sampled`

### Loading and caching

The library ships the score catalogue. Opening a piece fetches its source, and generating a performance starts LilyPond compilation and model loading concurrently. The tokenizer is emitted as a Vite content-hashed module paired with the model in `src/engine/assetRelease.ts`.

`public/_headers` gives hashed `/assets/*` a one-year browser TTL. HTML keeps the Workers Static Assets revalidation default. Model and soundfont requests use a revision from the release manifest. The same-origin Worker checks the R2 ETag, caches successful full GETs in the local Cloudflare edge cache, and supports range reads from those cached objects. Unversioned URLs remain available for older clients.

For an asset update, upload the file to a **new R2 key**, record its actual R2 ETag in the manifest, and update the matching tokenizer before building. Keep previous keys for older sessions. The first release references the existing keys in place.

To serve these public binaries via a dedicated CDN hostname instead, connect an R2 custom domain, enable a Cache Rule for the model and soundfont paths (keep the revision in the cache key), set object cache metadata, and configure CORS for the studio origin. Set `VITE_R2_PUBLIC_ORIGIN` to that HTTPS origin **at build time** (or set the identically named GitHub repository variable for CI). This bypasses the same-origin Worker for these files. Without this setting, no Cloudflare account changes are required.

Run `scripts/verify-studio.py` against a production build as described in the script. `PIANORA_URL` selects the server and `PIANORA_ARTIFACTS` selects the evidence directory. Set `PIANORA_VERIFY_EDGE=1` against Wrangler or the deployed Worker to also check static headers, cached byte ranges, conditional requests and legacy URLs. For local Wrangler tests, populate its local R2 bucket with the release model, default soundfont and ORT WASM files using `wrangler r2 object put ... --local`. The browser run records the initial assets, overlap of model transfer and compilation, and soundfont request count in `loading-performance.json`.
