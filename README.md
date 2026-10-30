# MEO website (C++ + JavaScript)

The website for the **Maritime Empowerment Organization (MEO)**: a JavaScript front end that is
filled from a content file, and a small C++ server that serves the site, the content and saves
form submissions.

```
meo-site/
├── data/
│   ├── content.json          ← ALL website text, numbers, news, team, partners, bank details
│   └── submissions/          ← created automatically: subscribers / messages / pledges (.jsonl)
├── public/                   ← what visitors download
│   ├── index.html            ← page layout (Action For Ocean–style sections)
│   ├── admin.html            ← staff dashboard
│   ├── css/style.css, css/admin.css
│   ├── js/app.js             ← loads /api/content, renders the page, sends the forms
│   ├── js/admin.js           ← staff dashboard logic
│   └── assets/images/        ← MEO photos, team portraits, partner logos
├── server/main.cpp           ← C++17 web server + REST API
├── third_party/              ← cpp-httplib and nlohmann/json (header-only, MIT licence)
├── CMakeLists.txt
└── Dockerfile
```

## 1. Build and run

**Linux / macOS / WSL**
```bash
cmake -S . -B build
cmake --build build -j
MEO_ADMIN_TOKEN="choose-a-long-secret" ./build/meo_server --port 8080
```

**Windows (Visual Studio 2019+ with "Desktop development with C++")**
```bat
cmake -S . -B build
cmake --build build --config Release
set MEO_ADMIN_TOKEN=choose-a-long-secret
build\Release\meo_server.exe --port 8080
```

Open http://localhost:8080 for the site and http://localhost:8080/admin.html for the staff dashboard.

**Docker**
```bash
docker build -t meo-site .
docker run -p 8080:8080 -e MEO_ADMIN_TOKEN=choose-a-long-secret -v meo-data:/app/data/submissions meo-site
```

### Settings (environment variables or flags)
| Variable | Flag | Default | Meaning |
|---|---|---|---|
| `MEO_PORT` | `--port` | 8080 | Port to listen on |
| `MEO_HOST` | `--host` | 0.0.0.0 | Address to bind |
| `MEO_PUBLIC_DIR` | `--public` | public | Website folder |
| `MEO_DATA_DIR` | `--data` | data | Folder with content.json and submissions |
| `MEO_ADMIN_TOKEN` | – | (empty) | Admin password. If empty, the admin API is switched off |

## 2. Updating the website content (no coding)
Edit **`data/content.json`** and save. The server reloads it automatically; refresh the page.
If you make a typing mistake in the file, the server keeps showing the last good version and
prints the error in its log.

- Impact numbers: `impact.stats` (they count up on screen)
- New news story: add an item at the **top** of `news` (`date` as `YYYY-MM-DD`, an `image` in `public/assets/images/`)
- Team changes: `team` (photo in `public/assets/images/team/`)
- Partners: `partners` (logo in `public/assets/images/partners/`)
- Bank details and suggested donation amounts: `donate`

## 3. REST API
| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/health` | Server status |
| GET | `/api/content` | The content.json data |
| POST | `/api/subscribe` | `{ "email": "...", "name": "..." }` → duplicates are ignored |
| POST | `/api/contact` | `{ "name", "email", "phone?", "subject", "message" }` |
| POST | `/api/pledge` | `{ "name", "email" or "phone", "amount", "programme?" }` → returns a `MEO-xxxx` reference |
| GET | `/api/admin/summary` | Counts and pledged total. Header `Authorization: Bearer <MEO_ADMIN_TOKEN>` |
| GET | `/api/admin/{subscribers,messages,pledges}` | Records, newest first (admin) |
| GET | `/api/admin/{subscribers,messages,pledges}.csv` | Excel-ready download (admin) |

Errors come back as `{ "ok": false, "error": "...", "fields": { "email": "invalid" } }` with 4xx status codes.

## 4. Security built in
- Input validation and length limits on every field; JSON size limit (16 KB)
- Hidden "honeypot" field blocks spam bots; 10 form posts per minute per visitor
- Admin token compared in constant time; admin pages are `noindex`
- Security headers on every response (Content-Security-Policy, X-Frame-Options, nosniff, Referrer-Policy)
- CSV export protected against spreadsheet formula injection
- Submissions are stored outside `public/`, so they can never be downloaded by visitors

**Before going live:** run behind HTTPS (e.g. Nginx or Caddy as a reverse proxy, or your host's TLS),
set a long random `MEO_ADMIN_TOKEN`, and back up `data/submissions/` regularly.

## 5. Hosting without the C++ server
The pages also work on plain static hosting (for example cPanel): copy `public/` to the host and
put a copy of `data/content.json` next to `index.html` as `content.json`. The forms then show
"please email info@meo.or.tz" because there is no server to receive them.

## 6. Quick start on Windows (no compiler needed)
Double-click **`start-windows.bat`**. It asks for an admin password, starts `dist\meo_server.exe`
and opens the site in your browser. If Windows Firewall asks, allow access on private networks.

## 7. One-file version
`python3 tools/build_single_html.py` creates **`dist/meo-website.html`**: the whole site in a single
file (styles, script, content and photos built in). Open it by double-clicking, email it, or upload it
anywhere. Without the C++ server its forms open the visitor's email app with their details filled in.
Re-run the script after editing `data/content.json`.
