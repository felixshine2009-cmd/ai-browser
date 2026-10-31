# GeoGebra Math Apps

v2 ships the full offline **GeoGebra Math Apps** bundle (5.4.x):

* Apps: **graphing**, **geometry**, **3D**, **CAS**, **scientific**, **suite**
* GeoGebra's own on-screen math keyboard (tabs **123 / f(x) / ABC / symbols**; `⌨ Keyboard` button in the panel bar, or focus the algebra input)
* Save / open `.ggb`, export PNG
* AI tools: `ggb_eval`, `ggb_clear`, `ggb_export_png`, `ggb_set_app`, `ggb_save`, `ggb_load`, `ggb_keyboard`, `ggb_state`

Commands use English GeoGebra syntax, one object per string, in dependency order.

All apps run from one codebase (`web3d`), so switching apps never reloads the page. 3D needs WebGL (real GPU on a real machine; software GL in CI).
