# Agent Tools

Builtin groups: browser, extensions, settings, language, knowledge, models, plus extension tools (GeoGebra, physics, dictionary).

## Highlights (v2)

* Bookmarks: `bookmarks_list`, `bookmark_add`, `bookmark_remove`
* Downloads: `downloads_list`, `download_open`, `download_clear`
* Find / zoom: `find_in_page`, `find_stop`, `zoom_set`, `zoom_get`
* Settings (safe subset only): `settings_get`, `settings_set` — **never** API keys or passwords
* Chrome extensions: `chrome_ext_list`, `chrome_ext_set_enabled`, `chrome_ext_remove`, `chrome_ext_install_store`
* Knowledge base: `kb_search`, `kb_add_text`, `kb_list`, `kb_delete`, `kb_clear`
* Models: `models_list`, `model_download`, `model_cancel`, `model_delete`, `model_select`

**Passwords are never exposed as agent tools.**
