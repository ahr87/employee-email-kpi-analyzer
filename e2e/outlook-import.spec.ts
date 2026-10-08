import { expect, test, type Page } from "@playwright/test";
import { ADDR, caseA, caseC, caseD, caseG, wrap } from "../tests/fixtures/outlook-export";

// Anonymized synthetic export only.
async function addEmployee(page: Page, id: string, name: string, email: string) {
  await page.getByRole("button", { name: "Add employee" }).click();
  await page.getByLabel("Employee ID").fill(id);
  await page.getByLabel("Employee name").fill(name);
  await page.getByLabel("Email address (matching key)").fill(email);
  await page.getByLabel("Department").fill("Customer Care");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
}

test("Import Outlook Export: choose JSON → preview → import → dashboard → duplicate re-import", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.hostname !== "127.0.0.1") external.push(r.url()); });

  await page.goto("");
  await page.getByRole("link", { name: "Employees" }).first().click();
  await addEmployee(page, "E1", ADDR.ahmed.name, ADDR.ahmed.email);
  await addEmployee(page, "E2", ADDR.sara.name, ADDR.sara.email);
  await page.getByRole("link", { name: "Settings" }).first().click();
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByPlaceholder("nmc@company.com").fill(ADDR.nmc.email);
  await page.getByRole("button", { name: "OK" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(/Settings saved/)).toBeVisible();

  await page.getByLabel("Year").first().selectOption("2026");
  await page.getByLabel("Month").first().selectOption("9");

  // both entry points exist
  await expect(page.getByRole("link", { name: "Paste & Analyze" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Import Outlook Export" }).first().click();

  const json = wrap([caseA(), caseC(), caseD(), ...caseG(), { subject: "broken message without entryId" }]);
  const upload = () => page.getByLabel("Outlook export file").setInputFiles({ name: "KPI_Outlook_Export_20261008_105731.json", mimeType: "application/json", buffer: Buffer.from(json, "utf8") });
  await upload();
  await expect(page.getByText("Outlook Import Preview")).toBeVisible();
  await expect(page.getByRole("button", { name: /Import 6 valid message\(s\) & Analyze/ })).toBeVisible();
  await page.getByRole("button", { name: /valid message\(s\) & Analyze/ }).click();
  await expect(page.getByText(/Import summary — Batch 001 · Outlook Desktop/)).toBeVisible({ timeout: 60_000 });

  // dashboard shows the source batch and the numbers
  await page.getByRole("link", { name: "Dashboard", exact: true }).first().click();
  await expect(page.getByText("Data sources for this month")).toBeVisible();
  await expect(page.getByText("KPI_Outlook_Export_20261008_105731.json").first()).toBeVisible();
  await expect(page.getByText("Outlook import").first()).toBeVisible();

  // importing the same file again adds nothing
  await page.getByRole("link", { name: "Import Outlook Export" }).first().click();
  await upload();
  await expect(page.getByText("Outlook Import Preview")).toBeVisible();
  await page.getByRole("button", { name: /Import/ }).filter({ hasText: "Analyze" }).first().click();
  await expect(page.getByText(/Import summary — Batch 002/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Emails", exact: true }).first().click();
  await expect(page.getByText(/^Employee emails/).first()).toBeVisible();

  expect(external).toEqual([]);
});
