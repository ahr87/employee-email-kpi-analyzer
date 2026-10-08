#!/usr/bin/env node
// Minimal static file server that mimics GitHub Pages for the exported site (./out) under a base path.
//   node scripts/serve-static.mjs [--port 4173] [--base /employee-email-kpi-analyzer] [--dir out]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const port = Number(arg("port", "4173"));
const base = arg("base", "/employee-email-kpi-analyzer").replace(/\/$/, "");
const root = path.resolve(arg("dir", "out"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon", ".png": "image/png", ".woff2": "font/woff2", ".map": "application/json" };

function resolveFile(urlPath) {
  const rel = decodeURIComponent(urlPath.slice(base.length)) || "/";
  const target = path.normalize(path.join(root, rel));
  if (!target.startsWith(root)) return null;
  for (const c of [target, path.join(target, "index.html"), `${target}.html`]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/" ) { res.writeHead(302, { Location: `${base}/` }); return res.end(); }
  if (!url.pathname.startsWith(base)) { res.writeHead(404); return res.end("404 (outside base path)"); }
  if (url.pathname === base) { res.writeHead(301, { Location: `${base}/` }); return res.end(); }
  let file = resolveFile(url.pathname);
  let status = 200;
  if (!file) { file = path.join(root, "404.html"); status = 404; if (!fs.existsSync(file)) { res.writeHead(404); return res.end("404"); } }
  res.writeHead(status, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`Serving ${root} at http://127.0.0.1:${port}${base}/`));
