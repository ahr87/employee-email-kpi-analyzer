import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const sources = walk(path.join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f));

describe("the production app is 100% client-side", () => {
  it("has no server code: no API routes, server actions, Prisma, SQLite or Node-only modules in src/", () => {
    expect(fs.existsSync(path.join(root, "src/app/api"))).toBe(false);
    const bad: string[] = [];
    for (const f of sources) {
      const text = fs.readFileSync(f, "utf8");
      const rel = path.relative(root, f);
      if (/@prisma|better-sqlite3|from "prisma|\bPrismaClient\b/.test(text)) bad.push(`${rel}: prisma/sqlite`);
      if (/from "node:|require\("(fs|path|crypto|child_process)"\)/.test(text)) bad.push(`${rel}: node module`);
      if (/from "next\/server"|"use server"|NextResponse|export (async )?function (GET|POST|PUT|PATCH|DELETE)\b/.test(text)) bad.push(`${rel}: server API`);
      if (/\bfetch\(\s*["'`]\/api/.test(text) || /["'`]\/api\//.test(text)) bad.push(`${rel}: /api call`);
    }
    expect(bad).toEqual([]);
  });

  it("package.json has no Prisma / SQLite / server runtime dependency", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => /prisma|sqlite|express|dotenv/.test(n))).toEqual([]);
    expect(pkg.scripts.build).toMatch(/^next build/);
  });

  it("is configured for a static export under the GitHub Pages base path", () => {
    const cfg = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
    expect(cfg).toMatch(/output:\s*"export"/);
    expect(cfg).toMatch(/basePath/);
    expect(cfg).toMatch(/trailingSlash:\s*true/);
    expect(cfg).toMatch(/unoptimized:\s*true/);
    expect(cfg).toContain("employee-email-kpi-analyzer");
  });

  it("the GitHub Actions deployment builds the static site and deploys only from main", () => {
    const wf = fs.readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8");
    expect(wf).toMatch(/branches:\s*\[\s*main\s*\]/);
    expect(wf).toMatch(/npm run build/);
    expect(wf).toMatch(/actions\/upload-pages-artifact/);
    expect(wf).toMatch(/actions\/deploy-pages/);
    expect(wf).not.toMatch(/claude\//);
  });

  it("no real data can be committed: .gitignore covers databases, backups and env files", () => {
    const ig = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    for (const p of [".env", "*.db", "employee-email-kpi-backup-*.json", "out"]) expect(ig).toContain(p);
  });
});
