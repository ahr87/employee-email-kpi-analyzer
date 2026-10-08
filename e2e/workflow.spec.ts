import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { chain, msg, NMC, T } from "../src/lib/demo/builders";

// Synthetic people and content only. Paths are RELATIVE so the GitHub Pages base path is honoured.
const ahmed = { from: "Ahmed Ali", email: "ahmed@company.test" };
const sara = { from: "Sara Hassan", email: "sara@company.test" };
const omar = { from: "Omar Khalid", email: "omar@company.test" };

const batch1 = [
  chain([
    NMC(T(14, 11, 40), "FW: MPLS Issue - Site X", "Please investigate Site X.", { to: "Field Team <field.team@company.test>" }),
    NMC(T(14, 10, 50), "RE: MPLS Issue - Site X", "Received and checking.", { to: "Ahmed Ali <ahmed@company.test>" }),
    { ...ahmed, at: T(14, 10, 32), subject: "MPLS Issue - Site X", body: "Service is unstable at Site X." },
  ]),
  chain([
    NMC(T(14, 12, 30), "رد: سؤال عن الفاتورة", "لا يتطلب اجراء، المشكلة معروفة مسبقا.", { to: "سارة <sara@company.test>" }),
    { ...sara, at: T(14, 12, 0), subject: "سؤال عن الفاتورة", body: "هل الفاتورة صحيحة؟" },
  ]),
  msg({ ...omar, at: T(14, 13, 0), subject: "Router reboot needed", body: "Please advise." }),
  msg({ from: "Zed Outsider", email: "zed@other.test", at: T(14, 13, 30), subject: "Fiber cut near Karrada", body: "Cable cut near Karrada junction." }),
].join("\n\n");

const batch2 = [
  msg({ ...omar, at: T(15, 9, 0), subject: "BB outage at Mansour", body: "Customers in Mansour have no BB. Circuit CKT-48213." }),
  msg({ ...sara, at: T(15, 9, 12), subject: "Mansour BB connection is down", body: "BB link down in Mansour, ckt-48213 red.\n\n<img src=x onerror=\"window.__xss=1\"><script>window.__xss=2</script>" }),
].join("\n\n");

const row = (page: Page, name: string | RegExp) => page.getByRole("row", { name });
const card = (page: Page, label: string) => page.locator("dt", { hasText: label }).locator("xpath=..").locator("dd");

async function addEmployee(page: Page, id: string, name: string, email: string) {
  await page.getByRole("button", { name: "Add employee" }).click();
  await page.getByLabel("Employee ID").fill(id);
  await page.getByLabel("Employee name").fill(name);
  await page.getByLabel("Email address (matching key)").fill(email);
  await page.getByLabel("Department").fill("Customer Care");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
}

async function analyze(page: Page, text: string) {
  const box = page.getByPlaceholder(/From: Name/);
  await box.fill(text);
  await page.getByRole("button", { name: "Analyze Emails" }).click();
}

test("first run, then copy → paste → analyze → review → report → export → backup → clear → restore (all in the browser)", async ({ page, context }) => {
  // every request the app makes: only its own static files, never an API or another host
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  const failures: string[] = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) failures.push(`${r.status()} ${r.url()}`); });
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  // ---- 1. open the application: friendly first-run page, nothing pre-loaded ----
  await page.goto("");
  await expect(page.getByRole("heading", { name: "Employee Email KPI" })).toBeVisible();
  await expect(page.getByText("Welcome — get your first monthly KPI in seven steps")).toBeVisible();
  await expect(page.getByText("Add or import your employees")).toBeVisible();
  await expect(page.getByText(/stays in this browser/)).toBeVisible();

  // ---- 2. add employees (UI) and the NMC address (Settings) ----
  await page.getByRole("link", { name: "Employees" }).first().click();
  await expect(page).toHaveURL(/\/employee-email-kpi-analyzer\/employees\/$/);
  await expect(page.getByText("No employees yet")).toBeVisible();
  await addEmployee(page, "E1", "Ahmed Ali", "ahmed@company.test");
  await addEmployee(page, "E2", "Sara Hassan", "sara@company.test");
  await addEmployee(page, "E3", "Omar Khalid", "omar@company.test");

  await page.getByRole("link", { name: "Settings" }).first().click();
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByPlaceholder("nmc@company.com").fill("nmc@acme.test");
  await page.getByRole("button", { name: "OK" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(/Settings saved/)).toBeVisible();

  // ---- 3. select September 2026, paste Outlook-style text, analyze ----
  await page.getByLabel("Year").first().selectOption("2026");
  await page.getByLabel("Month").first().selectOption("9");
  await page.getByRole("link", { name: "Paste & Analyze" }).click();
  await analyze(page, batch1);
  await expect(page.getByText(/Import summary — Batch 001/)).toBeVisible();
  await expect(card(page, "Imported")).toHaveText("7");
  await expect(card(page, "Matched employees")).toHaveText("3");
  await expect(card(page, "Unmatched")).toHaveText("1");
  await expect(card(page, "Review required")).toHaveText("2");

  // ---- 4. classifications and employee totals ----
  await page.getByRole("link", { name: "Emails" }).first().click();
  await expect(row(page, "MPLS Issue - Site X")).toContainText("Forwarded");
  await expect(row(page, "سؤال عن الفاتورة")).toContainText("Not Useful");
  await expect(row(page, "Router reboot needed")).toContainText("Pending");
  await expect(row(page, "Fiber cut near Karrada")).toContainText("Unmatched");
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect(page.locator("a", { hasText: "Total Emails" })).toContainText("4");
  await expect(row(page, "Ahmed Ali").locator("td").nth(1)).toHaveText("1");
  await expect(row(page, "Ahmed Ali").locator("td").nth(2)).toHaveText("1"); // forwarded

  // ---- 5. exact duplicate paste is ignored; a second batch accumulates ----
  await page.getByRole("link", { name: "Paste & Analyze" }).click();
  await analyze(page, batch1);
  await expect(page.getByText(/Import summary — Batch 002/)).toBeVisible();
  await expect(card(page, "Imported")).toHaveText("0");
  await expect(page.getByText("Duplicate email already exists")).toBeVisible();
  await analyze(page, batch2);
  await expect(page.getByText(/Import summary — Batch 003/)).toBeVisible();
  await expect(card(page, "Imported")).toHaveText("2");
  await expect(page.getByRole("row", { name: /Batch 001/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Batch 003/ })).toBeVisible();

  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect(page.locator("a", { hasText: "Total Emails" })).toContainText("6"); // 4 + 2, nothing double counted
  await expect(row(page, "Sara Hassan").locator("td").nth(1)).toHaveText("2");
  await expect(row(page, "Sara Hassan").locator("td").nth(4)).toHaveText("1"); // the Mansour duplicate

  // ---- 6. safe rendering of HTML in an email body ----
  await page.getByRole("link", { name: "Emails" }).first().click();
  await page.getByRole("link", { name: "Mansour BB connection is down" }).click();
  await expect(page.getByText("Duplicate relationship")).toBeVisible();
  await expect(page.locator("pre").first()).toContainText("<img src=x");
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  // ---- 7. manual override changes the KPI immediately ----
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect(row(page, "Omar Khalid").locator("td").nth(6)).toContainText("n/a"); // only pending emails: no score yet
  await page.getByRole("link", { name: "Review" }).first().click();
  await expect(page.getByRole("heading", { name: "Review Required" })).toBeVisible();
  const pending = page.locator("div.p-4", { hasText: "Router reboot needed" }).first();
  await pending.getByRole("button", { name: "Forwarded" }).click();
  await expect(page.getByText("Marked as Forwarded / Escalated.")).toBeVisible();
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect(row(page, "Omar Khalid").locator("td").nth(6)).toContainText("100");

  // ---- 8. exports (built in the browser) ----
  await page.getByRole("link", { name: "Reports" }).first().click();
  await expect(row(page, "Omar Khalid")).toBeVisible();
  const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export Excel" }).click()]);
  expect(xlsx.suggestedFilename()).toBe("email-kpi-2026-09-september.xlsx");
  const xlsxPath = await xlsx.path();
  const head = fs.readFileSync(xlsxPath).subarray(0, 2).toString();
  expect(head).toBe("PK");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Employee Details", "Email Details", "Classification Summary", "Review Required", "Employees"]);
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  expect(csv.suggestedFilename()).toBe("email-kpi-2026-09-september.csv");
  expect(fs.readFileSync((await csv.path())!, "utf8")).toContain("Omar Khalid");

  // ---- 9. backup → clear everything → restore → data is back ----
  await page.getByRole("link", { name: "Settings" }).first().click();
  const [backup] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export backup" }).click()]);
  expect(backup.suggestedFilename()).toMatch(/^employee-email-kpi-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backupPath = test.info().outputPath("backup.json");
  await backup.saveAs(backupPath);
  expect(JSON.parse(fs.readFileSync(backupPath, "utf8")).data.emails.length).toBe(9); // 7 messages (4 employee emails + 3 NMC) + 2 from batch 3

  await page.getByRole("button", { name: "Clear all local data" }).click();
  await expect(page.getByText("This deletes all employee, email, KPI and analysis data stored in this browser.")).toBeVisible();
  const confirmDelete = page.getByRole("button", { name: "Delete everything" });
  await expect(confirmDelete).toBeDisabled(); // needs the typed confirmation
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await confirmDelete.click();
  await expect(page.getByText("All local data was deleted from this browser.")).toBeVisible();
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect(page.getByText("Welcome — get your first monthly KPI in seven steps")).toBeVisible(); // empty again

  await page.getByRole("link", { name: "Settings" }).first().click();
  await page.getByLabel("Backup file").setInputFiles(backupPath);
  await expect(page.getByText(/contains 3 employees, 9 messages in 3 batches/)).toBeVisible();
  await page.getByRole("button", { name: "Replace current data with this backup" }).click();
  await expect(page.getByText("Backup restored (9 emails, 3 employees).")).toBeVisible();

  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect(page.locator("a", { hasText: "Total Emails" })).toContainText("6");
  await expect(row(page, "Omar Khalid").locator("td").nth(6)).toContainText("100"); // the manual override came back
  await page.getByRole("link", { name: "Emails" }).first().click();
  await expect(row(page, "Router reboot needed")).toContainText("Forwarded");
  await expect(row(page, "سؤال عن الفاتورة")).toContainText("Not Useful");

  // ---- 10. data survives closing and reopening the site (IndexedDB), and a deep link refresh works ----
  const reopened = await context.newPage();
  await reopened.goto("reports/");
  await reopened.getByLabel("Year").first().selectOption("2026");
  await reopened.getByLabel("Month").first().selectOption("9");
  await expect(row(reopened, "Omar Khalid")).toBeVisible();
  await reopened.reload();
  await expect(reopened.getByRole("heading", { name: "Monthly Report" })).toBeVisible();
  await expect(row(reopened, "Sara Hassan")).toBeVisible();

  // ---- 11. nothing but static files was ever requested; no failed loads ----
  const external = requests.filter((u) => !u.startsWith("http://127.0.0.1:3200/employee-email-kpi-analyzer/") && !u.startsWith("blob:") && !u.startsWith("data:"));
  expect(external).toEqual([]);
  expect(requests.filter((u) => u.includes("/api/"))).toEqual([]);
  expect(failures).toEqual([]);
  expect(consoleErrors.filter((e) => !/favicon/.test(e))).toEqual([]);
});

test("works offline after the first load (service worker + local database)", async ({ page, context }) => {
  await page.goto("");
  await expect(page.getByRole("heading", { name: "Employee Email KPI" })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload(); // now controlled by the service worker, which caches pages and assets as they load
  await page.getByRole("link", { name: "Employees" }).first().click();
  await page.getByRole("link", { name: "Paste & Analyze" }).click();
  await page.getByRole("link", { name: "Reports" }).first().click();
  await page.getByRole("link", { name: "Settings" }).first().click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("link", { name: "Employees" }).first().click();
  await addEmployee(page, "E9", "Offline Olga", "olga@company.test");
  await page.getByRole("link", { name: "Paste & Analyze" }).click();
  await analyze(page, msg({ from: "Offline Olga", email: "olga@company.test", at: T(16, 9, 0), subject: "Offline fault", body: "works without internet" }));
  await expect(page.getByText(/Import summary — Batch 001/)).toBeVisible();
  await page.getByLabel("Year").first().selectOption("2026");
  await context.setOffline(false);
});

test("synthetic demo data populates IndexedDB; search, employee page and review picker work", async ({ page }) => {
  await page.goto("settings/");
  await page.getByRole("button", { name: "Load synthetic demo data" }).click();
  await expect(page.getByText("Synthetic demo data loaded (September 2026).")).toBeVisible();

  await page.goto("");
  await expect(page.locator("a", { hasText: "Total Emails" })).toContainText("102");
  await expect(page.locator("a", { hasText: "Review Required" })).toBeVisible();
  await expect(page.getByText(/89 NMC message/)).toBeVisible();
  await expect(page.getByRole("row", { name: /علي حسين/ })).toBeVisible(); // Arabic employee name

  // header search → emails page with results
  await page.getByPlaceholder(/Search employee, subject/).fill("Mansour");
  await page.getByPlaceholder(/Search employee, subject/).press("Enter");
  await expect(page).toHaveURL(/\/employee-email-kpi-analyzer\/emails\/\?q=Mansour/);
  await expect(page.getByRole("link", { name: /Mansour|BB outage/ }).first()).toBeVisible();

  // employee page (static route with ?id=)
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await page.getByRole("link", { name: "Ahmed Ali" }).first().click();
  await expect(page).toHaveURL(/\/employee\/\?id=/);
  await expect(page.getByRole("heading", { name: /Ahmed Ali/ })).toBeVisible();
  await expect(page.getByText("Emails this month")).toBeVisible();

  // review: pick the original for a duplicate through the picker
  await page.goto("review/");
  await expect(page.getByRole("heading", { name: "Review Required" })).toBeVisible();
  const first = page.locator("div.p-4", { has: page.getByRole("button", { name: "Duplicate…" }) }).first();
  await first.getByRole("button", { name: "Duplicate…" }).click();
  await expect(page.getByText("Select the original email")).toBeVisible();
  await page.getByRole("dialog").locator("button", { hasText: "·" }).first().click();
  await expect(page.getByText("Marked as Duplicate.")).toBeVisible();
});
