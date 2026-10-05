import path from "node:path";
import fs from "node:fs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../generated/prisma/client";

function resolveUrl(): string {
  const url = process.env.DATABASE_URL ?? "file:./data/app.db";
  if (!url.startsWith("file:")) throw new Error("Only SQLite (file:) DATABASE_URL values are supported.");
  const rel = url.slice("file:".length);
  const abs = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return `file:${abs}`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: resolveUrl() }) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
