# Local Models

* Engines: llama.cpp (GGUF), MLX on Apple Silicon (optional `mlx-lm`), local frameworks (LM Studio, Ollama, oMLX, llama.cpp server, Jan, …)
* Downloads default to **hf-mirror.com** with automatic fallback to huggingface.co / custom endpoints
* Roles: chat / dictionary / translate / embedding can each point at a different model
* HY-MT translation model is **not** bundled (since 1.1.1); it downloads on first use
