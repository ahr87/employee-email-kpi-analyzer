import { handle } from "@/lib/api";
import { ImportError } from "@/lib/import/importer";
import { importEmployees } from "@/lib/employees/import-export";
export const POST = (req: Request) =>
  handle(req, async () => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ImportError("Choose a CSV or Excel (.xlsx) file.");
    if (!/\.(csv|xlsx)$/i.test(file.name)) throw new ImportError("Only .csv and .xlsx files are supported.");
    return importEmployees(file.name, Buffer.from(await file.arrayBuffer()));
  });
