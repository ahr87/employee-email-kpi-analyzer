import { execSync } from "node:child_process";
import fs from "node:fs";

export default function setup() {
  const url = "file:./data/test.db";
  process.env.DATABASE_URL = url;
  fs.mkdirSync("data", { recursive: true });
  for (const f of ["data/test.db", "data/test.db-journal"]) if (fs.existsSync(f)) fs.rmSync(f);
  execSync("npx prisma db push", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
