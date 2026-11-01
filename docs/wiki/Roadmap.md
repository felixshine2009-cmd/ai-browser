# Roadmap

* **Web version (PWA)** is live at https://felixshine2009-cmd.github.io/ai-browser/ : chat via your own API key, GeoGebra, physics (all-parameters), knowledge base in IndexedDB. Desktop-only features are shown grayed out.
* **WebGPU local models (web-v1.1.0)**: WebLLM quantized Qwen2.5 / Gemma 2 (~0.5–3B), EmbeddingGemma for semantic KB, feature-detect + gray-out, download progress, cache, phone memory warning, agent tools.
* **v3.0.0 (shipped)**: first-install onboarding wizard (language, name, AI model API/local, search engine, dictionary, done; skippable; reopen from Settings).
* **v3.1.0 (shipped)**: collapsible virtual keyboard on the home page (math + chemistry); also in Chat; agent tool; port to web.
* **v3.2.0 (shipped)**: AI self-modifying code — diff preview, explicit approval, sandbox/overlay, rollback, version history, safe mode; never touch passwords/secrets.
* **v3.3.0 (shipped)** + **web-v1.1.2**: confirmation before clearing history, resumable model downloads (Range / backoff / mirror fallback / pause-resume / sha256), per-model cache vs. files cleaning, agent tools.
* **Windows** builds return in a later release.
