# TRD Drone Checkout

Standalone borrow/return web app for the TRD drone fleet. It reads the
**📦 Drone stock + part Database (1)** in Notion (read-only) and writes
checkouts to the **🛸 Drone Borrow Log** — the same databases the Claude
artifact version uses, so both stay in sync.

Plain Node.js (18+), no npm packages. Teammates just open the URL — they
don't need Notion or Claude accounts; the "Your name" field in the borrow
form identifies the borrower.

## QR checkout

Supermarket-style scanning:

1. Open **QR labels** (top nav) on the deployed site → *Print labels* →
   cut out and stick one on each drone / case. Each label encodes
   `https://<your-app>/?scan=<item-id>`, so print from the real URL, not
   localhost.
2. To check out or return: tap **Scan** in the app (uses the camera;
   needs HTTPS, which Render provides) **or** just point any phone
   camera app at the label — either way the item's borrow or return
   form opens immediately. Scanning also accepts a typed serial number.

QR decoding uses the browser's native `BarcodeDetector` where available,
falling back to jsQR from a CDN; label rendering uses qrcode.js from a
CDN (both loaded only when used).

## 1. Notion setup (one time)

1. Go to https://www.notion.so/profile/integrations → *New integration*
   (internal, in the TH space workspace) → copy the secret (`ntn_…`).
2. In Notion, open each of these pages, click `⋯` (top right) →
   *Connections* → add your integration:
   - 📦 Drone stock + part Database (1)
   - 🛸 Drone Borrow Log

## 2. Environment variables

| Variable       | Required | What it is                                            |
|----------------|----------|-------------------------------------------------------|
| `NOTION_TOKEN` | yes      | The integration secret from step 1                    |
| `APP_KEY`      | for public hosting | Shared team password; visitors must enter it once |
| `PORT`         | no       | Defaults to 3000 (most hosts set this themselves)     |

Always set `APP_KEY` when the app is reachable from the internet —
without it, anyone who finds the URL can read your inventory and write
borrow records.

## 3. Run locally / on the LAN

```bash
NOTION_TOKEN=ntn_xxx APP_KEY=yourteampassword node server.js
```

Open http://localhost:3000 (teammates: `http://<your-ip>:3000`).

## 4. Host it on the internet (free)

**Render** (simplest):
1. Push this folder to a GitHub repository.
2. At https://render.com → *New → Web Service* → connect the repo.
3. Runtime **Node**, start command `npm start` (auto-detected).
4. Add environment variables `NOTION_TOKEN` and `APP_KEY`.
5. Deploy — you get a public `https://…onrender.com` URL to share.
   (Free instances sleep when idle; the first visit after a pause takes
   ~30 s to wake.)

**Railway** (railway.app): *New Project → Deploy from GitHub repo*, add
the same two variables. Similar free tier.

**Any Docker host / VPS**:
```bash
docker build -t drone-checkout .
docker run -d -p 3000:3000 -e NOTION_TOKEN=ntn_xxx -e APP_KEY=yourteampassword drone-checkout
```

## Files

- `server.js` — serves the page and proxies the Notion API
  (`GET /api/data`, `POST /api/borrow`, `POST /api/return`). The Notion
  token stays on the server; browsers only ever see the team key they
  typed themselves.
- `public/index.html` — the UI (iOS liquid-glass style).
- `Dockerfile`, `package.json` — deployment support.

## Notes

- Database IDs are hard-coded at the top of `server.js`; if you
  re-duplicate the stock database, update `STOCK_DB` there.
- Returns stamp `Returned On` and close the log record; nothing in the
  stock database is ever modified.
