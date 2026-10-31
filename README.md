# LeetComp — GitHub Pages build

This folder is a static HTML/CSS/JavaScript web app. It removes screen recording and OCR. Users enter a timed lockdown arena and write Python in a browser editor. Pyodide runs Python in a module Web Worker; sql.js stores accounts and results in a browser-local SQLite database backed by IndexedDB.

The catalog includes 56 problems and 1,641 simple plus deterministic generated cases. The generated inputs include small and odd sizes. The judge checks correctness, measures elapsed runtime and peak traced memory, and compares accepted runs in the local arena.

## Preview locally

From this folder run:

```sh
python3 -m http.server 8080
```

Open <http://localhost:8080>. The Python server here only serves static files; the app’s Python runtime is WebAssembly in the browser.

## Publish with GitHub Pages

1. Put the contents of this folder in the root of a public GitHub repository.
2. In that repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
4. Open the Pages URL GitHub provides. The first Python run downloads Pyodide from its versioned CDN and may take a little while.

## Browser-local data boundary

GitHub Pages serves static files and does not provide an application server or shared SQL database. Each browser gets its own SQLite database in IndexedDB: users can sign in on that browser, and their saved races and wins remain there, but accounts and leaderboards do not sync to other people or devices. The code, expected outputs, and generated cases are public in this repository, so this is a practice/demo judge rather than a cheat-resistant public contest. Runtime and memory comparisons are local to the browser and are not comparable across different devices.

The lockdown is an in-page focus screen with a fullscreen request. Browsers still let a person leave fullscreen or close a tab. Code autosaves locally; if the page is closed at time expiry, the automatic judge submission happens when the app is reopened.

For shared sign-in, cross-device history, a global SQL leaderboard, or a trusted contest judge, connect this static front end to a separate backend such as Supabase or the existing Flask/SQLite app in `leetcomp3-python-server`. GitHub Pages alone cannot provide those server features.

## Libraries

- [Pyodide](https://pyodide.org/en/stable/usage/webworker.html) runs Python in a Web Worker.
- [sql.js](https://sql.js.org/) provides SQLite in the browser.
- CodeMirror 5 supplies the Python editor appearance; a plain textarea remains available if its CDN is blocked.
