# Install

## macOS (Apple silicon)

1. Put **AI-Browser-mac-arm64.zip** and `install.command` in the same folder and double-click `install.command` (or `bash install.sh`).
2. The app is unsigned. If Gatekeeper blocks it: System Settings → Privacy & Security → Open Anyway, or `xattr -cr "/Applications/AI Browser.app"`.

## Windows

Paused: there is no Windows build after v1.1.1 (installer + portable zip are attached to the v1.1.1 release). Windows builds will return in a later release.

## Models

* **EmbeddingGemma** (knowledge base) is bundled.
* **HY-MT** (translation) downloads on first translation (~1.1 GB) via hf-mirror, with progress and resume.
