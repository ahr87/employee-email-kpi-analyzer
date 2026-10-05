import { handle } from "@/lib/api";
import { getSettings, saveSettings } from "@/lib/settings";
export const GET = () => handle(getSettings);
export const PUT = (req: Request) => handle(async () => saveSettings(await req.json()));
