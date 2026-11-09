// TRD Drone Checkout — static UI + small proxy to the Notion API.
// Run:  NOTION_TOKEN=ntn_xxx node server.js   (Node 18+, no npm packages needed)
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.NOTION_TOKEN;
const APP_KEY = process.env.APP_KEY || "";   // optional shared team password for the public internet
const STOCK_DB = "412ba2f496588187ad64f6d70c15cff9";   // 📦 Drone stock + part Database (1)
const LOG_DB = "1902f54054e04a168ec5980f78b112f0";     // 🛸 Drone Borrow Log
const NOTION = "https://api.notion.com/v1";

if (!TOKEN) {
  console.error("Set NOTION_TOKEN to your Notion internal-integration secret (see README.md).");
  process.exit(1);
}

const headers = {
  "Authorization": "Bearer " + TOKEN,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json"
};

async function notion(method, pathname, body) {
  const res = await fetch(NOTION + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || ("Notion API " + res.status));
  return data;
}

// Upload a data-URL image via Notion's File Upload API; returns the upload id.
async function notionUpload(dataUrl, filename) {
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("photo must be a base64 image data URL");
  const type = m[1], buf = Buffer.from(m[2], "base64");
  if (buf.length > 8 * 1024 * 1024) throw new Error("photo too large (max 8 MB)");
  const up = await notion("POST", "/file_uploads", { mode: "single_part", filename: filename, content_type: type });
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: type }), filename);
  const res = await fetch(NOTION + "/file_uploads/" + up.id + "/send", {
    method: "POST",
    headers: { "Authorization": "Bearer " + TOKEN, "Notion-Version": "2022-06-28" },
    body: fd
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || ("Notion upload " + res.status));
  return up.id;
}

async function queryAll(dbId) {
  const pages = [];
  let cursor;
  do {
    const data = await notion("POST", "/databases/" + dbId + "/query",
      cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 });
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return pages;
}

const text = p => { const t = (p && (p.title || p.rich_text)) || []; const s = t.map(x => x.plain_text).join(""); return s || null; };
const sel = p => (p && p.select && p.select.name) || null;
const date = p => (p && p.date && p.date.start) || null;
const appUrl = id => "https://app.notion.com/" + id.replace(/-/g, "");
const rich = s => ({ rich_text: [{ text: { content: s } }] });
const today = () => new Date().toISOString().slice(0, 10);

function mapItem(pg) {
  const p = pg.properties;
  const cover = pg.cover;
  return {
    id: pg.id, url: appUrl(pg.id), Name: text(p["Name"]), serial: text(p["Serial number"]),
    vendor: sel(p["Drone Vendor"]), type: sel(p["Type"]), location: sel(p["Location"]),
    photo: cover ? ((cover.file && cover.file.url) || (cover.external && cover.external.url) || null) : null
  };
}

function mapRecord(pg) {
  const p = pg.properties;
  const rel = p["Item"] && p["Item"].relation && p["Item"].relation[0];
  return {
    id: pg.id, url: appUrl(pg.id), created: pg.created_time,
    item: rel ? appUrl(rel.id) : ((p["Item Link"] && p["Item Link"].url) || null),
    borrower: text(p["Borrower"]), project: text(p["Project"]), dest: text(p["Destination"]),
    note: text(p["Note"]), status: sel(p["Status"]),
    bon: date(p["Borrowed On"]), due: date(p["Due Back"]), ron: date(p["Returned On"])
  };
}

async function handleApi(req, body) {
  if (req.method === "GET" && req.url === "/api/data") {
    const [stock, log] = await Promise.all([queryAll(STOCK_DB), queryAll(LOG_DB)]);
    const items = stock.map(mapItem).sort((a, b) => (a.Name || "").localeCompare(b.Name || ""));
    const records = log.map(mapRecord).sort((a, b) => b.created.localeCompare(a.created));
    return { items, records };
  }
  if (req.method === "POST" && req.url === "/api/borrow") {
    if (!body.itemId || !body.borrower) throw new Error("itemId and borrower are required");
    const props = {
      "Record": { title: [{ text: { content: (body.itemName || "Item") + " · " + body.borrower + " · " + today() } }] },
      "Item": { relation: [{ id: body.itemId }] },
      "Item Link": { url: appUrl(body.itemId) },
      "Borrower": rich(body.borrower),
      "Status": { select: { name: "Borrowed" } },
      "Borrowed On": { date: { start: today() } }
    };
    if (body.due) props["Due Back"] = { date: { start: body.due } };
    if (body.project) props["Project"] = rich(body.project);
    if (body.dest) props["Destination"] = rich(body.dest);
    if (body.note) props["Note"] = rich(body.note);
    await notion("POST", "/pages", { parent: { database_id: LOG_DB }, properties: props });
    return { ok: true };
  }
  if (req.method === "POST" && req.url === "/api/register") {
    // Creates a NEW page in the stock duplicate; never edits existing rows.
    if (!body.name) throw new Error("name is required");
    const props = { "Name": { title: [{ text: { content: body.name } }] } };
    if (body.serial) props["Serial number"] = rich(body.serial);
    if (body.vendor) props["Drone Vendor"] = { select: { name: body.vendor } };
    if (body.type) props["Type"] = { select: { name: body.type } };
    if (body.location) props["Location"] = { select: { name: body.location } };
    let extra = {};
    const photos = Array.isArray(body.photos) ? body.photos.slice(0, 8)
      : body.photo ? [body.photo] : [];
    if (photos.length) {
      // Each photo becomes an image block in the page body (no page cover).
      const base = body.name.replace(/[^\w.-]+/g, "_") || "drone";
      const children = [];
      for (let i = 0; i < photos.length; i++) {
        const fid = await notionUpload(photos[i], base + "-" + (i + 1) + ".jpg");
        children.push({ object: "block", type: "image", image: { type: "file_upload", file_upload: { id: fid } } });
      }
      extra = { children: children };
    }
    const pg = await notion("POST", "/pages",
      Object.assign({ parent: { database_id: STOCK_DB }, properties: props }, extra));
    return { ok: true, id: pg.id, url: appUrl(pg.id) };
  }
  if (req.method === "POST" && req.url === "/api/return") {
    if (!body.recordId || !body.borrower) throw new Error("recordId and borrower are required");
    await notion("PATCH", "/pages/" + body.recordId, { properties: {
      "Status": { select: { name: "Returned" } },
      "Returned On": { date: { start: today() } },
      "Borrower": rich(body.borrower)
    }});
    return { ok: true };
  }
  return null;
}

const INDEX = path.join(__dirname, "public", "index.html");

http.createServer((req, res) => {
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", async () => {
    try {
      if (req.url.startsWith("/api/")) {
        if (APP_KEY && req.headers["x-team-key"] !== APP_KEY) {
          res.writeHead(401, { "Content-Type": "application/json" });
          return res.end('{"error":"unauthorized"}');
        }
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        const out = await handleApi(req, body);
        if (out === null) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end('{"error":"not found"}'); }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(out));
      }
      fs.readFile(INDEX, (err, data) => {
        if (err) { res.writeHead(500); return res.end("public/index.html missing"); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
      });
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
  });
}).listen(PORT, () => console.log("TRD Drone Checkout running at http://localhost:" + PORT));
