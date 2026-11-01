# 本地模型调研（v1.0.1）

> 只收录 **已用 HTTP HEAD 验证** Hugging Face `resolve/main/...gguf` 返回 200 的条目（同时确认 hf-mirror.com 可拉混元）。  
> 架构均在本仓库捆绑的 `node-llama-cpp`（llama.cpp v0.7.0 系）`GgufArchitectureType` 中受支持：`qwen2` / `qwen3` / `hunyuanDense` / `llama`。

| 模型 | 用途 | Q4_K_M 体积 | 建议内存 | 仓库 / 文件 | 许可 | 备注 |
|---|---|---|---|---|---|---|
| Qwen2.5-7B-Instruct | 通用 | 4.7 GB | 16 GB+ | `Qwen/Qwen2.5-7B-Instruct-GGUF` / `qwen2.5-7b-instruct-q4_k_m.gguf` | Apache-2.0 | 原默认推荐 |
| Qwen3-4B | 通用 | 2.5 GB | 12 GB+ | `bartowski/Qwen_Qwen3-4B-GGUF` / `Qwen_Qwen3-4B-Q4_K_M.gguf` | Apache-2.0 | 同体积下强于 2.5-3B |
| **Hunyuan-MT-7B** | **翻译** | 4.6 GB | 16 GB+ | `mradermacher/Hunyuan-MT-7B-GGUF` / `Hunyuan-MT-7B.Q4_K_M.gguf` | 腾讯混元条款 | WMT2025 相关；33 语种；**翻译推荐** |
| **Seed-X-PPO-7B** | **翻译** | 4.6 GB | 16 GB+ | `mradermacher/Seed-X-PPO-7B-GGUF` / `Seed-X-PPO-7B.Q4_K_M.gguf` | Apache-2.0 | 需目标语言标签；官方建议 beam search（llama.cpp 默认无） |
| Qwen2.5-3B-Instruct | 轻量通用 | 2.1 GB | 8 GB+ | `Qwen/Qwen2.5-3B-Instruct-GGUF` | Apache-2.0 | |
| Qwen3-1.7B | 轻量通用 | 1.2 GB | 8 GB+ | `bartowski/Qwen_Qwen3-1.7B-GGUF` | Apache-2.0 | 词条/句子可用 |
| Qwen2.5-1.5B-Instruct | 轻量 | 1.1 GB | 8 GB | `Qwen/Qwen2.5-1.5B-Instruct-GGUF` | Apache-2.0 | |
| Qwen3-0.6B | 极速 | 0.5 GB | 6 GB | `bartowski/Qwen_Qwen3-0.6B-GGUF` | Apache-2.0 | 短任务 |
| Qwen2.5-0.5B-Instruct | 极速/测试 | 0.5 GB | 6 GB | `Qwen/Qwen2.5-0.5B-Instruct-GGUF` | Apache-2.0 | CI 用 |

未入库（原因）：
- **TowerInstruct / GemmaX2**：未找到稳定、单一 Q4_K_M 主文件或许可/模板不适合内嵌。
- **NLLB**：非 Causal LM，GGUF/llama.cpp 路径不友好。
- **Seed-X 非官方低 bit**：作者声明 greedy 质量差；仍提供 Q4_K_M 供用户自选。

箱内 CPU 实测：Qwen2.5-0.5B（已有 `/workspace/models/q05.gguf`）跑通词条/句子/译文格式；更大模型以公开评测与体积为准，未在 CI 全量下载。

设置页支持「长文翻译专用模型」：与通用模型分离，仅文章翻译走专用 GGUF。

## v3.3.0: resumable downloads and disk cleaning

See the wiki page *Local-Models* (Downloads / Disk usage and cleaning). Engine: `src/main/ai/dl.js` (Range resume, backoff, mirror fallback, verify), `src/main/ai/disk.js` (usage / clear cache / delete).
