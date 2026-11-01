# LeetComp — GitHub Pages build

LeetComp is a static HTML/CSS/JavaScript coding arena. Users create an account, enter a timed lockdown screen, and write Python in the browser editor. Pyodide runs in a Web Worker. Supabase Auth and Postgres provide shared accounts, private email/profile records, and daily topic standings. Signup creates an account immediately; email is reserved for password recovery. Passwords remain managed by Supabase Auth and are never stored in the app tables.

The catalog contains 56 problems and 1,641 example plus deterministic generated test cases. The browser judge checks correctness and measures runtime and traced memory. Accepted submissions are ranked against all accepted entries for the same topic and UTC day. A lone accepted entry starts at 100% for both time and memory; with multiple entries the percentile is based on relative performance, with ties receiving a mid-rank score. Percentiles and ranks are calculated in Postgres, and the live board refreshes every ten seconds. Yesterday’s final board and win notice appear on the dashboard.

## Supabase setup

The project URL and public publishable key are set in `config.js`. The SQL migration is in `supabase/competitions.sql`. It creates private per-user profile records and shared competition tables/functions. Run it in the Supabase SQL Editor after signup email confirmation is disabled in Authentication → Sign In / Providers.

Set the Supabase Auth site URL and allowed redirect URL to the GitHub Pages URL (for this repository: `https://herby-code01.github.io/leetcomp.v.3/`). Use email confirmation for new accounts. Never put a Supabase secret key or database password in this public repository.

## Account settings

Users can select Midnight Navy, Graphite, Arctic Light, or Violet Night and save a display name. Theme choice is stored in that browser; email, username, and display name are stored in Supabase. The profile table only allows each signed-in user to read or edit their own record.

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
