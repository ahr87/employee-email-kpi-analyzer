import { expect, test, type Page } from "@playwright/test";
import { chain, msg, NMC, T } from "../src/lib/demo/builders";

// Synthetic people and content only.
const ahmed = { from: "Ahmed Ali", email: "ahmed@company.test" };
const sara = { from: "Sara Hassan", email: "sara@company.test" };
const omar = { from: "Omar Khalid", email: "omar@company.test" };

const batch1 = [
  // forwarded: employee + NMC reply + forward (one copied chain, newest first)
  chain([
    NMC(T(14, 11, 40), "FW: MPLS Issue - Site X", "Please investigate Site X.", { to: "Field Team <field.team@company.test>" }),
    NMC(T(14, 10, 50), "RE: MPLS Issue - Site X", "Received and checking.", { to: "Ahmed Ali <ahmed@company.test>" }),
    { ...ahmed, at: T(14, 10, 32), subject: "MPLS Issue - Site X", body: "Service is unstable at Site X." },
  ]),
  // not useful (Arabic)
  chain([
    NMC(T(14, 12, 30), "رد: سؤال عن الفاتورة", "لا يتطلب اجراء، المشكلة معروفة مسبقا.", { to: "سارة <sara@company.test>" }),
    { ...sara, at: T(14, 12, 0), subject: "سؤال عن الفاتورة", body: "هل الفاتورة صحيحة؟" },
  ]),
  // pending: no evidence at all
  msg({ ...omar, at: T(14, 13, 0), subject: "Router reboot needed", body: "Please advise." }),
  // unmatched sender
  msg({ from: "Zed Outsider", email: "zed@other.test", at: T(14, 13, 30), subject: "Fiber cut near Karrada", body: "Cable cut near Karrada junction." }),
].join("\n\n");

const batch2 = [
  // business duplicate of the first incident's area, reported later by another employee (circuit id shared with batch 3)
  msg({ ...omar, at: T(15, 9, 0), subject: "BB outage at Mansour", body: "Customers in Mansour have no BB. Circuit CKT-48213." }),
  msg({ ...sara, at: T(15, 9, 12), subject: "Mansour BB connection is down", body: "BB link down in Mansour, ckt-48213 red.\n\n<img src=x onerror=\"window.__xss=1\"><script>window.__xss=2</script>" }),
].join("\n\n");

async function chooseMonth(page: Page) {
  await page.goto("/");
  await page.getByLabel("Year").first().selectOption("2026");
  await page.getByLabel("Month").first().selectOption("9");
}
const row = (page: Page, name: string) => page.getByRole("row", { name: new RegExp(name) });

test("copy → paste → analyze → review → report → export, with exact duplicates and multiple batches", async ({ page, request }) => {
  // --- synthetic setup through the API (employees + NMC address) ---
  await request.post("/api/admin/reset", { data: { confirm: "RESET", employees: true, settings: true } });
  for (const [id, name, email] of [["E1", "Ahmed Ali", "ahmed@company.test"], ["E2", "Sara Hassan", "sara@company.test"], ["E3", "Omar Khalid", "omar@company.test"]]) {
    expect((await request.post("/api/employees", { data: { employeeId: id, name, email, department: "Customer Care", team: "Baghdad" } })).ok()).toBeTruthy();
  }

  // --- NMC addresses are managed in Settings (add, disable, enable) ---
  await page.goto("/settings");
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByPlaceholder("nmc@company.com").fill("nmc@acme.test");
  await page.getByRole("button", { name: "OK" }).click();
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByPlaceholder("nmc@company.com").fill("@monitoring.acme.test");
  await page.getByRole("button", { name: "OK" }).click();
  await page.getByLabel("Enable @monitoring.acme.test").uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(/Settings saved/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Enable nmc@acme.test")).toBeChecked();
  await expect(page.getByLabel("Enable @monitoring.acme.test")).not.toBeChecked();

  // --- select the month, paste Outlook-style text, analyze ---
  await chooseMonth(page);
  await page.goto("/import");
  const box = page.getByPlaceholder(/From: Name/);
  await box.fill(batch1);
  await page.getByRole("button", { name: "Analyze Emails" }).click();
  const summary = page.getByText(/Import summary — Batch 001/);
  await expect(summary).toBeVisible();
  await expect(page.getByText("Exact duplicates ignored")).toBeVisible();
  const card = (label: string) => page.locator("dt", { hasText: label }).locator("xpath=..").locator("dd");
  await expect(card("Imported")).toHaveText("7"); // 4 employee emails + 3 NMC messages, chains are split into messages
  await expect(card("Matched employees")).toHaveText("3");
  await expect(card("Unmatched")).toHaveText("1");
  await expect(card("Review required")).toHaveText("2"); // pending + unmatched

  // --- exact duplicate paste adds nothing; batch 2 accumulates ---
  await box.fill(batch1);
  await page.getByRole("button", { name: "Analyze Emails" }).click();
  await expect(page.getByText(/Import summary — Batch 002/)).toBeVisible();
  await expect(card("Imported")).toHaveText("0");
  await expect(page.getByText("Duplicate email already exists")).toBeVisible();
  await box.fill(batch2);
  await page.getByRole("button", { name: "Analyze Emails" }).click();
  await expect(page.getByText(/Import summary — Batch 003/)).toBeVisible();
  await expect(card("Imported")).toHaveText("2");
  await expect(page.getByRole("row", { name: /Batch 001/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Batch 003/ })).toBeVisible();

  // --- the summary survives navigation, dashboard aggregates per employee ---
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Employee Email KPI" })).toBeVisible();
  await expect(page.locator("a", { hasText: "Total Emails" })).toContainText("6");
  const ahmedRow = row(page, "Ahmed Ali");
  await expect(ahmedRow).toContainText("1"); // total
  await expect(row(page, "Sara Hassan")).toBeVisible();
  // Sara: 1 not useful (Arabic) + 1 duplicate
  await expect(row(page, "Sara Hassan").locator("td").nth(1)).toHaveText("2");
  await expect(row(page, "Sara Hassan").locator("td").nth(4)).toHaveText("1");

  // --- classifications on the Emails page ---
  await page.goto("/emails");
  await expect(row(page, "MPLS Issue - Site X")).toContainText("Forwarded");
  await expect(row(page, "سؤال عن الفاتورة")).toContainText("Not Useful");
  await expect(row(page, "Mansour BB connection is down")).toContainText("Duplicate");
  await expect(row(page, "Router reboot needed")).toContainText("Pending");
  await expect(row(page, "Fiber cut near Karrada")).toContainText("Unmatched");

  // --- safe rendering: HTML in an email body is shown as text and never executed ---
  await page.getByRole("link", { name: "Mansour BB connection is down" }).click();
  await expect(page.getByText("Duplicate relationship")).toBeVisible();
  await expect(page.locator("pre").first()).toContainText("<img src=x");
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  // --- review: one click resolves an item and the totals change immediately ---
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "Review Required" })).toBeVisible();
  const pending = page.locator("div.p-4", { hasText: "Router reboot needed" }).first();
  await pending.getByRole("button", { name: "Forwarded" }).click();
  await expect(page.getByText("Marked as Forwarded / Escalated.")).toBeVisible();
  await page.goto("/");
  await expect(row(page, "Omar Khalid")).toContainText("100"); // forwarded counts for the KPI immediately

  // --- report + Excel export ---
  await page.goto("/reports");
  await expect(row(page, "Omar Khalid")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export Excel" }).click()]);
  expect(download.suggestedFilename()).toMatch(/email-kpi-2026-09-september\.xlsx$/);
});
