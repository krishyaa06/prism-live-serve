"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");

const MIME = { html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", map: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", xml: "application/xml", pdf: "application/pdf", wasm: "application/wasm", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", csv: "text/csv; charset=utf-8", webmanifest: "application/manifest+json" };
const mime = (f) => MIME[path.extname(f).slice(1).toLowerCase()] || "application/octet-stream";
const CLIENT = `<script>/* liveserve */(()=>{let t;const c=()=>{const s=new EventSource("/__liveserve");s.onmessage=e=>{const d=JSON.parse(e.data);if(d.css){let n=0;document.querySelectorAll('link[rel="stylesheet"]').forEach(l=>{const u=new URL(l.href);if(u.origin!==location.origin)return;u.searchParams.set("_lr",Date.now());l.href=u.href;n++});if(n)return}location.reload()};s.onerror=()=>{s.close();clearTimeout(t);t=setTimeout(c,1000)}};c()})();</script>`;
function inject(html) { return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, CLIENT + "</body>") : html + CLIENT; }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
function listing(dir, urlPath) {
  const ents = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  const rows = ents.map((e) => { const st = fs.statSync(path.join(dir, e.name)); const n = e.name + (e.isDirectory() ? "/" : ""); return `<a href="${esc(encodeURI(urlPath.replace(/\/?$/, "/") + n))}"><span>${e.isDirectory() ? "📁" : "📄"} ${esc(n)}</span><small>${e.isDirectory() ? "" : st.size < 1024 ? st.size + " B" : (st.size / 1024).toFixed(1) + " KB"}</small></a>`; }).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(urlPath)}</title><style>body{font:14px/1.5 ui-monospace,Menlo,monospace;background:#07060f;color:#e8e6f5;max-width:760px;margin:40px auto;padding:0 16px}h1{font-size:16px;color:#00d2ff}a{display:flex;justify-content:space-between;padding:8px 12px;border-radius:8px;color:inherit;text-decoration:none}a:hover{background:#15132a}small{color:#8b87a8}</style><h1>◆ ${esc(urlPath)}</h1>${urlPath !== "/" ? '<a href="../"><span>↩ ..</span></a>' : ""}${rows}`;
}
function lanIPs() { return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address); }

function createServer(root, { spa = false, cors = false, live = true, gzip = true, onRequest, headers = {} } = {}) {
  root = path.resolve(root);
  const clients = new Set();
  const server = http.createServer((req, res) => {
    const t0 = Date.now();
    const done = (code) => onRequest && onRequest({ method: req.method, url: req.url, status: code, ms: Date.now() - t0 });
    if (cors) { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "*"); }
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    if (req.url === "/__liveserve") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write("retry: 1000\n\n"); clients.add(res); req.on("close", () => clients.delete(res)); return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return done(405); }
    let urlPath; try { urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400); res.end("Bad request"); return done(400); }
    let file = path.join(root, path.normalize(urlPath));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end("Forbidden"); return done(403); }
    let st = fs.statSync(file, { throwIfNoEntry: false });
    if (st?.isDirectory()) {
      if (!urlPath.endsWith("/")) { res.writeHead(301, { Location: urlPath + "/" }); res.end(); return done(301); }
      const idx = path.join(file, "index.html");
      if (fs.existsSync(idx)) { file = idx; st = fs.statSync(idx); }
      else { const body = listing(file, urlPath); res.writeHead(200, { "Content-Type": MIME.html }); res.end(live ? inject(body) : body); return done(200); }
    }
    if (!st && !path.extname(urlPath) && fs.existsSync(file + ".html")) { file += ".html"; st = fs.statSync(file); }
    if (!st) {
      const spaIndex = path.join(root, "index.html"), nf = path.join(root, "404.html");
      if (spa && fs.existsSync(spaIndex) && !path.extname(urlPath)) { file = spaIndex; st = fs.statSync(file); }
      else { const body = fs.existsSync(nf) ? fs.readFileSync(nf, "utf8") : `<!doctype html><meta charset="utf-8"><title>404</title><body style="font:15px ui-monospace,monospace;background:#07060f;color:#e8e6f5;display:grid;place-items:center;height:90vh"><div><b style="color:#ff5e7e">404</b> · ${esc(urlPath)} not found</div></body>`; res.writeHead(404, { "Content-Type": MIME.html }); res.end(live ? inject(body) : body); return done(404); }
    }
    const type = mime(file);
    const h = { "Content-Type": type, "Cache-Control": "no-cache", "Last-Modified": st.mtime.toUTCString() };
    if (/text\/html/.test(type)) {
      let body = fs.readFileSync(file, "utf8"); if (live) body = inject(body);
      const buf = Buffer.from(body);
      send(buf, h, 200);
    } else {
      const etag = `W/"${st.size}-${st.mtimeMs | 0}"`; h.ETag = etag;
      if (req.headers["if-none-match"] === etag) { res.writeHead(304, h); res.end(); return done(304); }
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      if (range && st.size) {
        const start = range[1] ? +range[1] : st.size - +range[2], end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
        if (start > end || start < 0) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); res.end(); return done(416); }
        res.writeHead(206, { ...h, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
        if (req.method === "HEAD") { res.end(); return done(206); }
        fs.createReadStream(file, { start, end }).pipe(res); return done(206);
      }
      if (/^(text|application\/(json|javascript|xml|wasm)|image\/svg)/.test(type) && st.size < 8 << 20) send(fs.readFileSync(file), h, 200);
      else { res.writeHead(200, { ...h, "Content-Length": st.size, "Accept-Ranges": "bytes" }); if (req.method === "HEAD") { res.end(); return done(200); } fs.createReadStream(file).pipe(res); done(200); }
    }
    function send(buf, hdr, code) {
      if (gzip && buf.length > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) { buf = zlib.gzipSync(buf); hdr["Content-Encoding"] = "gzip"; hdr.Vary = "Accept-Encoding"; }
      hdr["Content-Length"] = buf.length; res.writeHead(code, hdr); res.end(req.method === "HEAD" ? undefined : buf); done(code);
    }
  });
  const reload = (changed) => { const msg = `data: ${JSON.stringify({ css: changed.every((f) => f.endsWith(".css")), files: changed })}\n\n`; for (const c of clients) c.write(msg); return clients.size; };
  server.reload = reload; server.clients = clients;
  return server;
}
const IGNORE = /(^|[/\\])(\.git|node_modules|\.DS_Store|\.cache|\.vscode|\.idea)([/\\]|$)|~$|\.swp$/;
function watch(root, onChange, { debounce = 80 } = {}) {
  let pending = new Set(), timer = null;
  const fire = (f) => { if (!f || IGNORE.test(f)) return; pending.add(f.split(path.sep).join("/")); clearTimeout(timer); timer = setTimeout(() => { const list = [...pending]; pending = new Set(); onChange(list); }, debounce); };
  try { const w = fs.watch(root, { recursive: true }, (_, f) => fire(f)); return () => w.close(); }
  catch { // Linux on older Node: recursive unsupported → watch each dir
    const ws = []; (function rec(d) { if (IGNORE.test(d)) return; try { ws.push(fs.watch(d, (_, f) => fire(path.relative(root, path.join(d, f || ""))))); for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) rec(path.join(d, e.name)); } catch {} })(root);
    return () => ws.forEach((w) => w.close());
  }
}
module.exports = { createServer, watch, inject, mime, lanIPs, CLIENT };
