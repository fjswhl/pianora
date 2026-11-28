# Pianora 琴境

> **Turn sheet music into living grand piano performances — 100% locally in your browser.**
> 让静态乐谱拥有钢琴家的呼吸与音乐厅灵魂：100% 纯前端零后端，端到端浏览器内完成制谱、AI 演奏演绎、交互指挥与真实三角钢琴声学渲染。

---

## Core Architecture (5-Stage Pure-Browser Pipeline)

1. **Stage 1 · In-Browser Sheet Music Compilation (`@sightread/lilypond-wasm`)**
   When Generate is clicked, the browser Worker compiles the selected or edited LilyPond source. MIDI and MusicXML imports use their own browser parsers. For MIDI, opening the sheet or enabling the follow score loads PlanetScore locally and converts the original file to MusicXML. Both views reuse the same OSMD engraving. Playback uses the original performance timing. MIDI and symbolic ornaments are prepared for playback first. The listening view loads the engraving independently and shares it with the full sheet view. Both paths use the same Mutopia/2.18 sanitization and Scheme hook.
2. **Stage 2 · Symbolic Ornament Extraction (Scheme Engraver)**
   Injects a custom LilyPond Scheme Engraver (`Demo_arpeggio_collector_engraver`) to extract exact symbolic moments (such as `\arpeggio`) that standard MIDI drops.
3. **Stage 3 · On-device expressive performance**
   Choose a model in the score editor. PianoFlow uses WebGPU or WASM. Pianist Transformer, DExter and VirtuosoNet load the selected ONNX graphs on demand and run inside a Web Worker using WASM. Score parsing, sampling and MIDI generation run on the visitor’s device.
4. **Stage 4 · Symbolic Precision Restoration**
   Restores rolled arpeggios bottom-to-top while preserving 100% of the AI pianist's rubato, dynamics, and voicing — with real-time slider retuning (< 1 ms).
5. **Stage 5 · Studio Acoustic Grand Piano Engine (Pure Web Audio + AudioWorklet)**
   - **5-Velocity-Layer Yamaha C5 (Salamander)** fast-start engine + **SpessaSynth AudioWorklet** SoundFont2 engine (`Abbey Steinway D`, `Nice Steinway v3.8`, `Dore Mark Fazioli F308`, plus local `.sf2/.sf3/.dls` import)
   - **Custom AudioWorklet Sympathetic String & Soundboard Resonance** (`public/audio/sympathetic_resonance.js`): 28-mode damped harmonic resonator bank with realistic string inharmonicity + 4-line diffused spruce soundboard body halo
   - **Real Concert Hall Convolution Reverb (`ConvolverNode`)**: Vienna Musikverein, 18th-Century French Salon, La Scala Opera Hall, St. Nicolaes Church
   - **Sample-Accurate Offline WAV Export**: renders through the exact same sympathetic resonance + hall convolution chain via `OfflineAudioContext`.

---

## Performance models

| Model | Compressed download | Browser rendering |
| --- | ---: | --- |
| PianoFlow (default) | Existing PianoFlow pack | Flow matching with seven interactive editing modes |
| Pianist Transformer | 97 MiB | Int8 linear projections, cached autoregressive decoding, 512-note windows and nucleus sampling |
| DExter | 204 MiB | 200-note segments with a 10-note overlap. Choose 32-step DDIM for speed or the original 999-step DDPM sampler in generation settings |
| VirtuosoNet | 45 MiB | HAN + GRU note, voice, beat and measure encoders with autoregressive tempo, velocity, articulation and pedal prediction |

The three additional models share the editor’s MIDI, MusicXML and LilyPond import paths. MusicXML supplies voice and notation information. MIDI and compiled LilyPond use track and meter information. MIDI exports carry the predicted pedal controls. Playback and WAV rendering extend note lengths using the sustain pedal. Quantization, sampling and score feature extraction can produce a different take from the upstream Python demos. Checkpoint sources and notices are in [model credits](public/notices/performance-models/SOURCES.txt).

## 7 Interactive PianoFlow Modes

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

# 4. Optional: compress installed release binaries for the browser download cache
npm run setup:packs

# 5. Install the three additional models from the pinned GitHub release (uses curl and tar)
npm run setup:performance-models

# 6. Run dev server or production build
npm run dev
# or
npm run build && npm run preview
```

## Deployment (Cloudflare Workers + R2)

Production runs as a single Cloudflare Worker on **https://opuslin.uk** (`wrangler.jsonc` → `routes[].custom_domain`).

| Payload | Served from |
| --- | --- |
| UI bundle, IRs, small runtime files (≤ 25 MiB each) | Workers Static Assets (`dist/`) |
| Compressed model, ORT WASM and SF2 chunks | Workers Static Assets under content-addressed `/packs/` URLs |
| Original ONNX model, ORT WASM, SF2 SoundFonts | R2 bucket `pianora-assets`, streamed by `worker/index.ts` with full `Range` support |

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
typechecks, restores or creates the binary download packs, builds the UI, then runs `wrangler deploy`. R2 objects are untouched by CI.

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

The library ships the score catalogue. Opening a piece fetches its source. Generating starts score preparation and model loading concurrently. The browser Worker extracts MIDI and arpeggio events without fitting pages. The SVG pass engraves the score with LilyPond, caching repeated named glyph paths for that run. On devices reporting four or more logical cores, engraving overlaps model inference. Other devices request it when opening the listening or sheet view. The most recently prepared source is reused across seed and parameter changes. The tokenizer is emitted as a Vite content-hashed module paired with the model in `src/engine/assetRelease.ts`.

`public/_headers` gives hashed `/assets/*` a one-year browser TTL. HTML keeps the Workers Static Assets revalidation default. Model and soundfont requests use a revision from the release manifest. The same-origin Worker checks the R2 ETag, caches successful full GETs in the local Cloudflare edge cache, and supports range reads from those cached objects. Unversioned URLs remain available for older clients.

The default piano, model and ORT runtime are split into individually verified gzip chunks. A visible library or editor can fetch them during idle time. Data-saving, cellular and slow connections skip background downloads. Choosing another piano loads it on demand. Foreground use shares in-flight chunks, and later visits reuse the compressed bytes in Cache Storage. If a pack is unavailable, the app falls back to the original asset. Run `scripts/verify-asset-packs.py` to exercise background transfer, cache reuse, recovery and playback.

For an asset update, upload the file to a **new R2 key**, record its actual R2 ETag in the manifest, and update the matching tokenizer before building. Keep previous keys for older sessions. The first release references the existing keys in place.

To serve these public binaries via a dedicated CDN hostname instead, connect an R2 custom domain, enable a Cache Rule for the model and soundfont paths (keep the revision in the cache key), set object cache metadata, and configure CORS for the studio origin. Set `VITE_R2_PUBLIC_ORIGIN` to that HTTPS origin **at build time** (or set the identically named GitHub repository variable for CI). This bypasses the same-origin Worker for these files. Without this setting, no Cloudflare account changes are required.

Run `scripts/verify-studio.py` against a production build as described in the script. `PIANORA_URL` selects the server and `PIANORA_ARTIFACTS` selects the evidence directory. Set `PIANORA_VERIFY_EDGE=1` against Wrangler or the deployed Worker to also check static headers, cached byte ranges, conditional requests and legacy URLs. For local Wrangler tests, populate its local R2 bucket with the release model, default soundfont and ORT WASM files using `wrangler r2 object put ... --local`. The browser run records the initial assets, overlap of model transfer and compilation, and soundfont request count in `loading-performance.json`.

Run `scripts/verify-score-compilation.py` against a production build to verify browser compilation, engraving and source reuse across seed changes. Run `scripts/verify-browser-engraving.py` to compare reference and optimized Worker timings, MIDI, arpeggio events and every SVG page through real playback. The scripts write `score-compilation.json` and `browser-engraving.json` to the evidence directory.

The listening view follows the selected performance through up to three engraved systems. LilyPond supplies the system bounds, bar lines and volta events. The player maps measure boundaries to the actual note onsets for the selected take. Run `scripts/verify-follow-score.py` against the local production build to exercise playback, seeking, repeats and the mobile layout and capture screenshots.

### Accounts and private scores

Opening “我的曲库” loads Clerk on demand. Clerk handles registration, sign-in and verification email. The Worker checks the Clerk session signature, issuer, expiration and authorized origin before accessing the owner's scores in D1 and private R2. “保存到曲库” saves the source score and, when available, the selected performance.

Create a Clerk Hobby production instance for `opuslin.uk`, enable email codes for registration and sign-in, and verify the DNS records supplied by Clerk. Set the GitHub repository variable `CLERK_PUBLISHABLE_KEY` to the production publishable key. The Worker fetches public signing keys from the instance. Set `PIANORA_D1_ID` to the private library database ID. The account controls appear when the Worker has the database, bucket and publishable key.

Deployment applies D1 migrations. With a restricted deployment token, run `PIANORA_D1_ID=<uuid> node scripts/deploy-accounts.mjs --apply-schema` using an authorized Wrangler profile and set the repository variable `PIANORA_APPLIED_SCHEMA` to the printed database ID and digest. Changes to the migration files or database require a new migration run.

For local development, run `CLERK_PUBLISHABLE_KEY=<dev publishable key> node scripts/account-config.mjs --local`, then `npx wrangler d1 migrations apply DB --local -c wrangler.accounts.generated.json`. Build the frontend and start `npx wrangler dev --local --port 8791 -c wrangler.accounts.generated.json`. Run `bash scripts/ci-accounts.sh` after building with Python Playwright and Chromium installed to verify private access against a local Worker with signed session fixtures. The report is written to `artifacts/accounts.json`. For the hosted login flow, start the local Worker with a Clerk development instance in test mode and run `python3 scripts/verify-clerk-login.py` with its development `CLERK_SECRET_KEY`. It exercises the email-code form, restores a saved score after refresh and writes `artifacts/clerk-login.json`.

### 界面语言与翻译

在页面顶部选择「中文」或「English」即可切换语言。首次使用默认中文，浏览器通过 `pianora.locale` 保存选择。切换语言时可以继续编辑或试听当前乐谱。

中文原文用作消息键，英文译文集中在 `src/i18n/en.json`。组件用 `t(key, ...values)` 渲染文案，含变量的句子用 `{0}`、`{1}` 占位。需要留在状态中的异步提示用 `message` 创建，在展示时调用 `display`。账户 API 通过 `Accept-Language` 接收界面语言，登录组件跟随界面语言，验证码邮件由 Clerk 投递。

启动带有本地演奏资源的 `npm run preview` 后，运行 `python scripts/verify-i18n.py`（需要 Python Playwright 和 Chromium）。脚本会生成 `artifacts/i18n.json` 和两张界面截图。

### 播放时查看和声

演奏室默认打开「和声分析」。在「试听与导出」或「查看谱面」中播放，当前和弦会随音乐高亮，旁边显示和弦类型和下一个和弦。「显示级数」可在和弦下方加上当前调内的罗马数字。MIDI 可以先看当前和弦，再点击「显示 MIDI 随奏谱」打开五线谱。

Pianora 优先读取 MusicXML 的和弦标记或 LilyPond 的 ChordNames。其余段落按原谱音高、低音和时值估算，因此分解和弦、经过音密集的段落和临时转调可能有多种解释。无法确定调内级数时，仅显示和弦。使用本地资源启动预览后，可运行 `python scripts/verify-harmony.py` 重放浏览器验证，生成和声截图与 JSON 报告。
