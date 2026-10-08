#!/usr/bin/env node
// After `next build`: write out/precache.json (every page + static asset) and stamp the build version into out/sw.js,
// so the service worker can make the whole app available offline and refresh itself on every deployment.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const out = path.resolve("out");
const files = [];
const walk = (dir) => {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full);
    else files.push(path.relative(out, full).split(path.sep).join("/"));
  }
};
walk(out);

const SKIP = /(^sw\.js$|^precache\.json$|\.map$|^\.nojekyll$|\.txt$)/; // .txt = client-navigation payloads (fetched on demand)
const assets = files.filter((f) => !SKIP.test(f) && !/(^|\/)index\.html$/.test(f) && f !== "404.html");
const pages = files.filter((f) => /(^|\/)index\.html$/.test(f)).map((f) => f.replace(/index\.html$/, "")); // "", "emails/", ...
const list = [...pages, "404.html", ...assets].sort();
const version = createHash("sha256").update(list.join("\n") + files.filter((f) => f.endsWith(".js") || f.endsWith(".css") || f.endsWith(".html")).map((f) => fs.statSync(path.join(out, f)).size).join(",")).digest("hex").slice(0, 12);

fs.writeFileSync(path.join(out, "precache.json"), JSON.stringify({ version, files: list }));
const sw = path.join(out, "sw.js");
fs.writeFileSync(sw, fs.readFileSync(sw, "utf8").replaceAll("__BUILD_VERSION__", version));
console.log(`postbuild: ${list.length} files in the offline cache list, version ${version}`);
