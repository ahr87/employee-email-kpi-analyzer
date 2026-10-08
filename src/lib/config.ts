/**
 * Deployment configuration — the one place that knows where the app is hosted.
 * GitHub Pages serves this repository under /employee-email-kpi-analyzer; local development uses the root.
 * `next.config.ts` reads the same values, so nothing else hard-codes a path.
 */
export const REPO_NAME = "employee-email-kpi-analyzer";
export const PAGES_BASE_PATH = `/${REPO_NAME}`;

/** Injected at build time by next.config.ts ("" for local development). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix a public asset path (e.g. the service worker) with the base path. */
export const assetPath = (p: string) => `${BASE_PATH}${p.startsWith("/") ? p : `/${p}`}`;
