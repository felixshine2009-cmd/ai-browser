# AI Browser Web (PWA)

Static, offline-capable web build of AI Browser. Build with `scripts/build-web.sh <outdir>` (adds the GeoGebra bundle and physics engine), serve `<outdir>` over HTTPS, then use *Add to Home Screen* on iPhone Safari.

* Chat / search / dictionary / translation use your own OpenAI-compatible API (key stays in `localStorage`; the provider must allow browser CORS).
* Desktop-only features are shown grayed out and toast "Desktop only".
