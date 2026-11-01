[**English**](README.md) | [中文](README_zh.md)

# AI Browser v3.3.0

A desktop browser (Electron / Chromium) with an AI **Chat mode** built in: dictionary lookup (MDX/MDD), sentence analysis, translation, **agentic web search** with cited answers, a local knowledge base, and GeoGebra plotting. An AI agent can drive the browser itself through a single tool registry.

**Web version (PWA):** https://felixshine2009-cmd.github.io/ai-browser/ — chat via your own API key **or WebGPU local models** (WebLLM quantized Qwen2.5 / Gemma 2, ~0.5–3B; EmbeddingGemma for the knowledge base); GeoGebra, physics; desktop-only features are grayed out. Add to Home Screen on iPhone Safari. Current web release: `web-v1.1.0`.

Targets **Apple Silicon (M1/M2/M3) macOS 12+**. The app is tested end-to-end on Linux (xvfb + Playwright); things that need a real Mac are listed under *Known limitations*.

## What's new in 3.3.0

* **Confirmation before clearing history** — every path (History page, per-range *last hour / 24 h / all*, Settings → Privacy, Downloads list, and the new AI tool `history_clear`) shows the same dark modal: what is deleted and how many items, a red **Confirm clear** and **Cancel** (default focus), Esc / outside-click cancel. Afterwards a prominent "Cleared N" banner. The AI can never clear silently: its request appears in the same dialog (labelled "requested by AI") and declining deletes nothing.
* **Resumable model downloads (new engine `dl.js`)** — HTTP `Range` resume from `.part` files that survive restart / crash / network drop, **Pause / Resume** buttons, automatic retry with exponential backoff, mirror fallback (hf-mirror ⇄ huggingface.co) that keeps resuming the *same* file, clean restart if a server ignores `Range` (200 instead of 206), size + sha256 verification (on mismatch the file is deleted and re-downloaded, with the reason shown). Progress shows bytes done/total, speed and ETA plus status text (*Paused*, *Network lost, will retry automatically*, *Verifying*). Applies to GGUF, MLX multi-file snapshots, EmbeddingGemma, HY-MT and Hugging Face custom models (HY-MT / EmbeddingGemma first-use downloads now share the same job).
* **Model cache vs. model files** — Settings → Local models shows per-model disk usage split into *Model files* and *Cache* (unfinished `.part` downloads, temp files, runtime caches, and the knowledge-base embedding vectors that belong to EmbeddingGemma), with **Clear cache** (model stays usable) and **Delete model files** per row, a section-level **Clear all model caches** and a total. Running models are unloaded first; a deleted model's role (chat / dictionary / translate / embedding) is cleared with a notice; bundled EmbeddingGemma shows that KB search needs it, with a re-download button. LM Studio / Ollama folders are shown read-only and never touched. Every delete uses the confirmation dialog and ends with "Freed X".
* Agent tools: `local_models_download`, `local_models_pause`, `local_models_resume`, `local_models_status`, `local_models_disk_usage`, `local_models_clear_cache`, `local_models_delete` (the last two always ask the user), `history_clear`.
* Web (web-v1.1.2): per-shard resumable WebLLM downloads (completed shards stay in Cache Storage; pause / resume continues from the next shard; automatic retry + mirror fallback), per-model *Clear cache* vs *Delete model* with `navigator.storage.estimate()`, the same confirmation modal (also for "clear knowledge base"), and the same agent tools. Also fixes the service worker deleting WebLLM's model cache on every update.

## What's new in 3.2.0

* **AI self-modifying code (sandboxed)**: the agent can propose patches; you see a unified diff and must explicitly approve. Patches write only to a userData overlay — the app bundle is never overwritten. One-click rollback, version history, and safe mode after launch failures. Passwords, secrets, preload and `store.js` are blocked.
* Agent tools: `code_propose_patch`, `code_pending_patch`, `code_list_patches`, `code_rollback`, `code_safe_mode`. Open `aibrowser://selfmod` or Settings → General.

## What's new in 3.1.0


* **Collapsible math / chemistry virtual keyboard** on the home page (collapsed by default) and in Chat follow-up: tabs for Math, Chem, Greek and Ops; inserts at the caret.
* Agent tools `vkeyboard_toggle`, `vkeyboard_insert`, `vkeyboard_catalog`.
* Same keyboard on the web PWA.

## What's new in 3.0.0


* **First-install onboarding wizard**: language → display name → AI model (API / local) → search engine → dictionaries (optional) → done. Skippable at any step; reopen anytime from **Settings → General**.
* Agent tool `browser_open_page` accepts `onboarding`.

## What's new in 2.2.0


* **Every physics quantity is customisable** — a new *Params* panel (slider + number box + unit, collapsible on small screens) for 19 parametric high-school modules: projectile, incline (static μ₀ ≠ kinetic μ, angle, mass), circular motion, pendulum, spring, collision (restitution e), gravitation (G, M, R), SHM, waves (λ, T, v, f, φ), charged particle in plates + B (q, m, U, d, B, direction), circuits (DC / RC / RL / AC with ε, r, R, C, L, ρ, wire length and cross-section, frequency, peak), transformer, induction (N, area, B, ω), refraction (n₁, n₂, incidence, live critical angle, wavelength), thin lens (f, u, h), spherical mirror, ideal gas (isothermal / isobaric / isochoric / adiabatic, n, p, V, T, γ, c, m), photoelectric (ν, W₀, h, stopping voltage, threshold) and radioactive decay (half-life, N₀).
* Rigid-body scenes gained static / kinetic friction on walls and floor, restitution, E-field by `{mag, angle}` or `{U, d}`, B-field by `{mag, dir}`, and `planet{G,M,R}` → g.
* Derived values (range, critical angle, time constants, Ek, …) update live; out-of-range input shows a clear error; scenes export / import as JSON.
* New agent tools `phys_set_param`, `phys_update`, `phys_list_params`; a test asserts that every parameter changes the simulation output.
* Web version updated with the same panel (see the wiki page *Physics-Parameters*).

## What's new in 2.1.0

* **High-school physics visualizer**: deterministic 2D engine for mechanics, oscillation / waves, electromagnetism, optics, thermal and modern topics; scene JSON is validated before loading (the AI retries on errors); play / pause / step / speed, vectors, trails, live plots; 15 example scenes; agent tools `phys_validate`, `phys_load`, `phys_play`, `phys_pause`, `phys_step`, `phys_reset`, `phys_set_speed`, `phys_state`, `phys_list_examples`, `phys_load_example`.
* **More agent tools**: bookmarks, downloads, find-in-page, zoom, safe settings changes, Chrome extension management, knowledge-base delete / clear, local model management (never passwords).
* Incognito page reading uses the private session.
* Translation-model download failures show a clear reason in the chat UI.

## What's new in 2.0.0

* **Full GeoGebra Math Apps**, offline: graphing / geometry / 3D / CAS / scientific / suite, on-screen math keyboard (123 / f(x) / ABC / symbols), save/open `.ggb`, PNG export, AI control via `ggb_*` tools.
* **New app icon** (ring + aurora).
* Removed the greeting decoration glyph.

## What's new in 1.1.0

* **Incognito tabs** — *New incognito tab* is the first item in the top-right four-squares menu (⇧⌘N). It uses its own in-memory session: no shared cookies, storage, history or saved passwords, a dark-purple tab with a badge, and everything is wiped when the last incognito tab closes.
* **Agent tool registry** — one set of function-calling tools (OpenAI / Anthropic compatible, with a grammar-constrained JSON fallback for local models): browser actions (tabs, incognito, navigate, history, extensions), search / read page, dictionary, translation + grammar analysis, knowledge base, settings (read-only, no keys), print / save as PDF, plus tools declared by any 功能拓展. New extensions register their tools automatically. Tool steps show briefly in the chat UI; the step limit is configurable.
* **Knowledge base** — bundled **EmbeddingGemma-300M** (offline, `task: search result | query: …` prompts), chunking + local vector store, add files / web pages / text, search test, optional custom embedding API.
* **Hunyuan translation** — **HY-MT1.5-1.8B** (not bundled since 1.1.1 — about 1.1 GB, downloaded on first translation from hf-mirror with progress and resume), loaded only while translating (sentence / article / page / `translate_text` tool) and unloaded after ~2.5 min idle. It is never used for chat or the dictionary. A custom API or any model assigned to the *translate* role can replace it.
* **Local models, reworked** — engine selector (llama.cpp GGUF / MLX on Apple Silicon), downloads go through **hf-mirror.com** by default (switch to huggingface.co or a custom URL; automatic fallback), **search Hugging Face** or paste a repo, resumable downloads with sha256 check, custom models usable for chat / dictionary / translate / embedding. Models are **grouped by family** (Qwen3, Qwen2.5, Gemma 4, Gemma 3n, Gemma 3, Hunyuan-MT, EmbeddingGemma …) in collapsible groups.
* **Local frameworks** — auto-detects **LM Studio** (:1234), **Ollama** (:11434, native API), **oMLX** (:8000), MLX-LM / llama.cpp server (:8080), vLLM, Jan, LocalAI or any OpenAI-compatible server; custom host/port, connection tests with specific reasons, streaming, native tool calling with JSON fallback.
* **MLX engine** (Apple Silicon) — spawns a local OpenAI-compatible `mlx_lm.server`, lazy start / idle stop, falls back to llama.cpp with a visible reason. Needs `pip3 install mlx-lm` (not bundled).
* **Passwords** — built-in manager (Passwords in the four-squares menu → Settings → 密码): save prompt on sign-in, autofill, search, reveal / export only after Touch ID or your macOS password, edit / delete, CSV import / export, stored with Electron `safeStorage` (Keychain). Never saved in incognito. **No AI tool can read passwords.**
* **Print… (⌘P) and Save as PDF** in the menu; the AI may open the print dialog, nothing more.
* **Dictionaries are copied into the app's data folder** (mdx, every same-name `.mdd`, css / js / fonts / images) with progress and disk size; removing one deletes its copy (with confirmation); existing path-based dictionaries are migrated on start (or show a clear *source missing* reason).
* **Chrome extensions install straight from the Chrome Web Store** — open an extension page and press *Add*; "Load unpacked" is an advanced fallback.
* **Settings readability fixes** — the dictionary panel no longer renders a white box in the dark theme; every settings panel is checked by an automated ≥ 4.5:1 contrast test.

## Install (recommended)

| File | Description |
|---|---|
| `AI-Browser-mac-arm64.zip` | Unsigned `AI Browser.app` (macOS arm64) — includes EmbeddingGemma (knowledge base); the HY-MT translation model downloads on first use |
| `install.command` / `install.sh` | Unzip → copy to `/Applications` → `xattr -cr` → launch |
| `AI-Browser-source.zip` | Source (no `node_modules`, no model files) |
| `README.md` / `README-zh.md` | English / Chinese README |

**macOS:**

1. Put `AI-Browser-mac-arm64.zip` and `install.command` in the same folder.
2. Double-click `install.command` (or run `bash install.sh`).
3. If macOS says the developer cannot be verified: System Settings → Privacy & Security → Open Anyway, or run `xattr -cr "/Applications/AI Browser.app" && open "/Applications/AI Browser.app"`.

**Windows:** paused — no Windows build since v1.1.1 (last Windows assets: [v1.1.1](https://github.com/felixshine2009-cmd/ai-browser/releases/tag/v1.1.1)). Windows builds will return in a later release.

## First run

1. **Settings → General**: display name, greeting, 中文 / English.
2. **Settings → AI Model**: *Custom API* (presets, OpenAI / Anthropic format, **Test connection** with specific failure reasons), *Local model* (built-in catalog, Hugging Face search, engine and download source, model roles) or *Local frameworks* (LM Studio, Ollama, oMLX …).
3. **Search engine**: Bing / Google / Baidu / DuckDuckGo / custom `%s`; the agent uses the selected engine.
4. **Dictionaries**, **Knowledge base**, **Extensions**, **History**, **Passwords** and **Privacy** are sections in the same Settings page (`aibrowser://settings#passwords` …).

Without a configured model, asking gives a friendly error — the app does not crash.

## Chat mode

| Input | Behaviour |
|---|---|
| Single word | Dictionary extension (MDX) first; otherwise an AI-generated entry marked “AI generated” |
| Sentence | Translation (HY-MT) + subject / predicate / object colouring and structure breakdown |
| Long text | Translation only, source / translation columns |
| Question | **Agentic search** with `[n]` citations, or any other registered tool (knowledge base, browser actions …) |

## Models and licences

* Built-in catalog (GGUF for llama.cpp, plus `mlx-community` MLX variants): **Qwen3**, **Qwen2.5**, **Gemma 4** (E2B / E4B / 12B / 26B-A4B / 31B, Apache-2.0), **Gemma 3n**, **Gemma 3**, **Hunyuan-MT**, Seed-X, **EmbeddingGemma**. Size and estimated RAM are shown for every entry.
* **Gemma 3 / 3n / EmbeddingGemma** are covered by the [Gemma Terms of Use](https://ai.google.dev/gemma/terms) and prohibited-use policy; **Gemma 4** is Apache-2.0. The bundled EmbeddingGemma file is distributed under the Gemma terms.
* **HY-MT1.5** is under the Tencent Hunyuan Community License (**not licensed in the EU, UK and South Korea**); check it before redistributing.
* Qwen models are Apache-2.0 (Qwen3, most Qwen2.5 sizes — see each model card).

## Extensions

* **Feature extensions** (`aib-feature/1`, see [`docs/EXTENSION_STANDARD.md`](docs/EXTENSION_STANDARD.md)): Dictionary, GeoGebra and Physics are pre-installed; extensions can declare agent tools in `manifest.contributes.tools`.
* **Chrome extensions** (MV3): installed from the Chrome Web Store inside the browser. Coverage is limited by Electron's extension API support (content scripts, service workers and `chrome.storage` are tested; toolbar popups are limited).
* GeoGebra is bundled for **non-commercial** use under the [GeoGebra license](https://www.geogebra.org/license).

## From source

```bash
unzip AI-Browser-source.zip && cd ai-browser
npm ci
npm start
npm run dist:mac   # build the darwin-arm64 app (dist/); drop the two .gguf files in ./models first to bundle them
```

## Tests

```bash
xvfb-run -a node test/run-all.js          # all suites (real model inference is off by default: AIB_REAL_INFERENCE=1)
xvfb-run -a node test/run-all.js 16       # one suite, e.g. passwords + print
```

## Known limitations

1. **Needs verification on a real Mac:** Metal inference with node-llama-cpp (Gemma 4 GGUF loading is untested), the MLX engine (tested only against a mock `mlx_lm.server`), Touch ID prompts, the native print dialog.
2. The app is unsigned / not notarised.
3. Chrome-extension API coverage is limited by Electron.
4. Search engines may show captchas to scripted requests; the fallback chain and relevance filter mitigate this.
5. `mlx-lm` is not bundled (`pip3 install mlx-lm`), or use oMLX through *Local frameworks*.

## Roadmap

* **Web version (PWA)** is live on GitHub Pages — next batch adds WebGPU local models (WebLLM / transformers.js).
* **v3**: first-install onboarding setup screen.
* Windows builds return in a later release.
* English GitHub Wiki (source in `docs/wiki`).
* v3 idea: the AI edits the browser's own code to add features.

License: MIT. Author: Felix.

*Created by Grok.*
