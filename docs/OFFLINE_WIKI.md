# Offline wiki

The app reads **ZIM** encyclopedias — the same file format used by the Kiwix app. Choose a `.zim` file on the offline-wiki page. The desktop app copies it into the application data directory (like dictionaries), so moving or deleting the original later does not affect the copy. The web version stores the file in the browser’s application storage when the browser allows it.

After the file is opened, the encyclopedia homepage is shown. You can search titles and open full article pages, including images, styles, and internal links. Download encyclopedias from the [Kiwix library](https://library.kiwix.org/). Do not commit a multi-gigabyte dump to the repository.

JSONL import remains a secondary path: each line is `{"title":"...","text":"..."}`. On desktop, paste it on the wiki tool page or drop `*.jsonl` into the `wiki` folder inside the app’s user-data directory.
