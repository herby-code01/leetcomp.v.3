# LeetComp — GitHub Pages build

LeetComp is a static HTML/CSS/JavaScript coding arena. Users create an account, enter a timed lockdown screen, and write Python in the browser editor. Pyodide runs in a Web Worker. Supabase Auth and Postgres provide shared accounts and daily topic standings.

The catalog contains 56 problems and 1,641 example plus deterministic generated test cases. The browser judge checks correctness and measures runtime and traced memory. Accepted submissions are ranked against all accepted entries for the same topic and UTC day. Percentiles and ranks are calculated in Postgres, and the live board refreshes every ten seconds. Yesterday’s final board and win notice appear on the dashboard.

## Supabase setup

The project URL and public publishable key are set in `config.js`. The SQL migration is in `supabase/competitions.sql`; the subscriptions table used by this app is created by `supabase/schema.sql`. These have been applied to the Supabase project. For a new project, run `schema.sql` first, then `competitions.sql`.

Set the Supabase Auth site URL and allowed redirect URL to the GitHub Pages URL (for this repository: `https://herby-code01.github.io/leetcomp.v.3/`). Use email confirmation for new accounts. Never put a Supabase secret key or database password in this public repository.

## Preview locally

Run `python3 -m http.server 8080` in this folder and open <http://localhost:8080>. Add `http://localhost:8080/` to Supabase Auth’s allowed redirect URLs for local development.

## Publish with GitHub Pages

In the repository, open **Settings → Pages** and choose **Deploy from a branch**, `main`, and `/ (root)`.

## Data and judging notes

Supabase stores accounts and competition submissions centrally. Code drafts and personal attempt history remain in that browser’s IndexedDB. Python execution, runtime, and memory measurements are client-side, so device differences can affect performance standings. The problem cases and judge code are public in this repository, so the leaderboard is shared but not cheat-resistant; a trusted contest needs server-side judging with protected tests.

The lockdown is an in-page focus screen with a fullscreen request; browsers still allow leaving fullscreen or closing a tab.

## Libraries

- Supabase JS for hosted authentication and shared Postgres data.
- Pyodide to run Python in a Web Worker.
- sql.js and IndexedDB for local drafts and history.
- CodeMirror 5 for the Python editor.
