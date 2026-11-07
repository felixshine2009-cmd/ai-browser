# Offline wiki

The app ships a small set of original study notes and can search them offline, together with the web.

To add more pages, import a JSONL file where each line is `{"title":"...","text":"..."}`. On desktop, paste it on the wiki tool page or drop `*.jsonl` into the `wiki` folder inside the app's user-data directory. Do not commit a multi-gigabyte dump.

A full encyclopedia dump is optional. Export the articles you need as that JSONL (one object per line). The reader does not download or bundle a complete dump.
