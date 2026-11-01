# Local Models

* Engines: llama.cpp (GGUF), MLX on Apple Silicon (optional `mlx-lm`), local frameworks (LM Studio, Ollama, oMLX, llama.cpp server, Jan, …)
* Downloads default to **hf-mirror.com** with automatic fallback to huggingface.co / custom endpoints
* Roles: chat / dictionary / translate / embedding can each point at a different model
* HY-MT translation model is **not** bundled (since 1.1.1); it downloads on first use

## Downloads (v3.3.0)

* Resumable: HTTP Range from `<file>.part` (+ `.part.json`), survives restart / crash / network drop. Server ignoring Range → clean restart of that file.
* Automatic retry with exponential backoff; after a failure the next endpoint (hf-mirror.com ⇄ huggingface.co) resumes the **same** `.part`.
* **Pause / Resume** buttons; status line shows bytes done/total, speed, ETA, *Paused* / *Network lost, will retry automatically* / *Verifying*.
* Size + sha256 verified at the end; mismatch → file deleted and re-downloaded (bounded), reason shown.
* Agent tools: `local_models_download`, `local_models_pause`, `local_models_resume`, `local_models_status`.

## Disk usage and cleaning (v3.3.0)

* Each downloaded model row shows **Model files** (weights/config) and **Cache** (unfinished `.part`, temp files, runtime caches, KB embedding vectors for EmbeddingGemma).
* **Clear cache** keeps the model usable; **Delete model files** unloads the model, clears its role and frees the most space. **Clear all model caches** + total at the section level.
* LM Studio / Ollama folders are shown read-only and never touched; a read-only copy inside the app bundle is never deleted.
* Every delete uses the same confirmation dialog (default focus Cancel) and ends with "Freed X". Agent tools `local_models_disk_usage`, `local_models_clear_cache`, `local_models_delete` (the last two always ask).
