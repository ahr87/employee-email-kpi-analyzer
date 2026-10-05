import { handle } from "@/lib/api";
import { getSettings, saveSettings } from "@/lib/settings";
import { analyzeAllMonths } from "@/lib/import/analyze";
export const GET = () => handle(getSettings);
/** PUT body = settings; optional `reanalyze: true` re-runs the analysis of every month (manual decisions stay protected). */
export const PUT = (req: Request) =>
  handle(async () => {
    const { reanalyze, ...patch } = (await req.json()) as { reanalyze?: boolean } & Record<string, unknown>;
    const settings = await saveSettings(patch);
    const months = reanalyze ? await analyzeAllMonths() : 0;
    return { ...settings, reanalyzedMonths: months };
  });
