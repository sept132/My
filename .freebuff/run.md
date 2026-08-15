# Run Doc — My (Personal Assistant & Productivity Suite)

## How to reproduce artifacts
None. The app is a **zero-dependency static site**: all runtime assets (JS, CSS,
fonts, Font Awesome, Chart.js, PDF.js, JSZip, Leaflet) live in `www/` and are
committed. No `.env` files exist, nothing needs to be copied, and there is no
build step (`npm run build` is a no-op). `node_modules` is only needed for
Capacitor/Android work (`bun install` + `bunx cap sync android`), not for the web app.

## How to run the server
- Preferred dev/preview server: `node server.js` (alias `npm run dev` / `npm start`).
  Zero npm dependencies — works without `npm install`. Serves `www/` on
  `http://0.0.0.0:8080` (override with the `PORT` env var).
- **In the Freebuff sandbox** `node` is **not installed**, so use a Python
  static server instead (Python 3 is available):
  `python -m http.server 8081 --bind 127.0.0.1` (run from the project root, serves `www/`).
  - Important: do **not** register the preview with `htmlPath` (single-file mode
    serves only the HTML — all sibling CSS/JS/vendor assets 404). A real
    directory server on a free port (8081, since 8080 is taken by the agent
    service) is required.
  - Windows detach (survives the conversation, hidden window, pid printed):
    `powershell -NoProfile -Command "$p = Start-Process -FilePath 'C:\Users\HP\AppData\Local\Python\pythoncore-3.14-64\python.exe' -ArgumentList '-m','http.server','8081','--bind','127.0.0.1' -WorkingDirectory '<project root>' -RedirectStandardOutput '<log>' -RedirectStandardError '<log>.err' -WindowStyle Hidden -PassThru; $p.Id"`
    (stdout and stderr must go to different files; the call may appear to
    "time out" — that is normal, the server still starts.)
