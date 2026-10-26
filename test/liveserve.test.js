const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createServer, inject, mime } = require("../src");

function site() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ls-"));
  fs.writeFileSync(path.join(d, "index.html"), "<html><body><h1>hi</h1></body></html>");
  fs.mkdirSync(path.join(d, "docs")); fs.writeFileSync(path.join(d, "docs/a.txt"), "x".repeat(3000));
  fs.writeFileSync(path.join(d, "about.html"), "<p>about</p>");
  return d;
}
const start = (d, o) => new Promise((r) => { const s = createServer(d, o); s.listen(0, "127.0.0.1", () => r(s)); });
const get = (s, p, headers = {}) => new Promise((r, j) => http.get({ host: "127.0.0.1", port: s.address().port, path: p, headers }, (res) => { let b = ""; res.on("data", (x) => (b += x)); res.on("end", () => r({ status: res.statusCode, headers: res.headers, body: b })); }).on("error", j));

test("inject + mime", () => {
  assert.match(inject("<body>x</body>"), /EventSource\("\/__liveserve"\).*<\/body>$/s);
  assert.equal(mime("a.CSS"), "text/css; charset=utf-8"); assert.equal(mime("x.unknown"), "application/octet-stream");
});
test("serves files, injects client, listing, clean urls, 404, traversal", async () => {
  const s = await start(site());
  try {
    const i = await get(s, "/"); assert.equal(i.status, 200); assert.match(i.body, /<h1>hi<\/h1><script>\/\* liveserve/);
    const l = await get(s, "/docs/"); assert.match(l.body, /a\.txt/);
    assert.equal((await get(s, "/docs")).status, 301);
    assert.match((await get(s, "/about")).body, /about/);
    assert.equal((await get(s, "/nope")).status, 404);
    assert.equal((await get(s, "/../../etc/passwd")).status, 404);
    assert.notEqual((await get(s, "/%2e%2e/%2e%2e/etc/passwd")).status, 200);
    assert.notEqual((await get(s, "/..%2f..%2fetc%2fpasswd")).status, 200);
    const g = await get(s, "/docs/a.txt", { "accept-encoding": "gzip" }); assert.equal(g.headers["content-encoding"], "gzip");
    const r = await get(s, "/docs/a.txt", { range: "bytes=0-9" }); assert.equal(r.status, 206); assert.equal(r.body.length, 10);
  } finally { s.close(); }
});
test("spa fallback + sse reload", async () => {
  const s = await start(site(), { spa: true });
  try {
    assert.match((await get(s, "/dashboard/settings")).body, /<h1>hi/);
    const msg = await new Promise((resolve) => {
      http.get({ host: "127.0.0.1", port: s.address().port, path: "/__liveserve" }, (res) => {
        res.setEncoding("utf8"); let buf = "";
        res.on("data", (d) => { buf += d; if (buf.includes("data:")) { res.destroy(); resolve(buf); } });
        setTimeout(() => s.reload(["css/a.css"]), 50);
      });
    });
    assert.match(msg, /"css":true/);
  } finally { s.close(); }
});
