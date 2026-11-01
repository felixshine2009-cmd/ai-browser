# AI Browser Web (PWA)

Static, offline-capable web build of AI Browser.

## Features

* Chat via your own OpenAI-compatible API **or** a **WebGPU local model** (WebLLM: quantized Qwen2.5 / Gemma 2 / Llama 3.2, ~0.5–3B). Feature-detects WebGPU; if missing, the local engine is grayed out with a clear reason.
* Download progress, browser model cache, and a phone memory warning for larger models.
* **Resumable per-shard downloads** (v1.1.2): completed shards stay in Cache Storage; Pause / Resume continues from the next shard; automatic retry with backoff and hf-mirror fallback. Storage list per model (*Model files* vs *Cache*), `navigator.storage.estimate()`, *Clear cache* / *Delete model* behind a confirmation dialog (also for clearing the knowledge base).
* Dictionary (AI), translation, GeoGebra, physics (all-parameters panel), knowledge base (IndexedDB; optional **EmbeddingGemma** vector search via transformers.js).
* Web agent tools: `local_models_list`, `local_model_load`, `local_model_unload`, `local_model_status`, `webgpu_detect`, `kb_embed_status`, `local_models_download`, `local_models_pause`, `local_models_resume`, `local_models_status`, `local_models_disk_usage`, `local_models_clear_cache`, `local_models_delete` (delete/clear always ask).
* Desktop-only features are grayed out (tabs / incognito, desktop llama.cpp / MLX, Chrome extensions, passwords, print).

## Build / serve

```bash
scripts/build-web.sh dist-web zip   # includes GeoGebra + physics assets
python3 -m http.server 8080 --directory dist-web
```

Serve over HTTPS (or localhost). On iPhone Safari: Share → Add to Home Screen.

WebGPU needs Chrome / Edge 113+ or Safari 18+ with a real GPU. First model load downloads into the browser cache. On phones prefer 0.5B / 1.5B.
