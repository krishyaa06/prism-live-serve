#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");
const { createServer, watch, lanIPs } = require("../src");
const { c, header, plural } = require("../src/ui");
const pkg = require("../package.json");

const HELP = `${header("liveserve", "static server with live reload")}

${c.bold("Usage")}
  liveserve [dir] [options]

${c.bold("Options")}
  -p, --port <n>       port (default 5500, next free one if busy)
  -H, --host <addr>    bind address (default 0.0.0.0 → shows LAN URL for your phone)
  -o, --open           open the browser
      --spa            serve index.html for unknown routes (React / Vue routers)
      --cors           Access-Control-Allow-Origin: *
      --no-live        disable live reload
      --no-gzip        disable compression
  -q, --quiet          don't log requests
  -v, --version / -h, --help

CSS changes are hot-swapped without a page reload.`;

let a;
try { a = parseArgs({ allowPositionals: true, options: { port: { type: "string", short: "p" }, host: { type: "string", short: "H", default: "0.0.0.0" }, open: { type: "boolean", short: "o" }, spa: { type: "boolean" }, cors: { type: "boolean" }, "no-live": { type: "boolean" }, "no-gzip": { type: "boolean" }, quiet: { type: "boolean", short: "q" }, version: { type: "boolean", short: "v" }, help: { type: "boolean", short: "h" } } }); }
catch (e) { console.error(c.red(`✖ ${e.message}`)); process.exit(2); }
const o = a.values;
if (o.help) { console.log(HELP); process.exit(0); }
if (o.version) { console.log(pkg.version); process.exit(0); }
const root = path.resolve(a.positionals[0] || ".");
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) { console.error(c.red(`✖ Not a directory: ${root}`)); process.exit(2); }
const want = o.port ? +o.port : +(process.env.PORT || 5500);
if (!(want > 0 && want < 65536)) { console.error(c.red("✖ Invalid port")); process.exit(2); }

const time = () => new Date().toTimeString().slice(0, 8);
const SC = (s) => (s >= 500 ? c.red : s >= 400 ? c.yellow : s >= 300 ? c.cyan : c.green)(String(s));
const server = createServer(root, { spa: o.spa, cors: o.cors, live: !o["no-live"], gzip: !o["no-gzip"], onRequest: o.quiet ? null : (r) => console.log(`  ${c.dim(time())} ${SC(r.status)} ${c.dim(r.method.padEnd(4))} ${r.url} ${c.gray(r.ms + "ms")}`) });

let port = want, tries = 0;
server.on("error", (e) => {
  if (e.code === "EADDRINUSE" && !o.port && tries++ < 20) { port++; server.listen(port, o.host); return; }
  console.error(c.red(`✖ ${e.code === "EADDRINUSE" ? `Port ${port} is in use (try: npx github:krishyaa06/prism-port-killer ${port})` : e.message}`)); process.exit(1);
});
server.listen(port, o.host, () => {
  const local = `http://localhost:${port}`;
  console.log(header("liveserve", path.relative(process.cwd(), root) || "."));
  console.log(`\n  ${c.dim("Local")}    ${c.bold(c.accent(local))}${port !== want ? c.yellow(`  (${want} was busy)`) : ""}`);
  if (o.host === "0.0.0.0") for (const ip of lanIPs().slice(0, 2)) console.log(`  ${c.dim("Network")}  ${c.accent(`http://${ip}:${port}`)}  ${c.dim("← open on your phone")}`);
  console.log(`  ${c.dim("Mode")}     ${[!o["no-live"] && c.green("live reload"), o.spa && c.cyan("spa"), o.cors && c.cyan("cors"), !o["no-gzip"] && c.dim("gzip")].filter(Boolean).join(c.dim(" · "))}\n`);
  if (o.open) { const { spawn } = require("node:child_process"); const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open"; try { spawn(cmd, process.platform === "win32" ? ["/c", "start", "", local] : [local], { stdio: "ignore", detached: true }).unref(); } catch {} }
});
if (!o["no-live"]) watch(root, (files) => {
  const n = server.reload(files);
  if (!o.quiet) console.log(`  ${c.dim(time())} ${c.accent("↻")} ${files.length > 3 ? plural(files.length, "file") : files.join(", ")} ${c.dim(files.every((f) => f.endsWith(".css")) ? `css hot-swap → ${plural(n, "tab")}` : `reload → ${plural(n, "tab")}`)}`);
});
process.on("SIGINT", () => { console.log(c.dim("\n  bye")); process.exit(0); });
