import { expect, test } from "@playwright/test";

const email = (id: number) => `From: Fay Tester <fay.tester@acme.test>
Sent: Tuesday, September 8, 2026 1${id}:00 AM
To: NMC Desk <nmc@acme.test>
Subject: E2E check ${id}

Synthetic body ${id}.
`;

test("paste → analyze → review → report → export", async ({ page, request }) => {
  // synthetic data only
  expect((await request.post("/api/admin/demo")).ok()).toBeTruthy();

  // dashboard
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Employee Email KPI" })).toBeVisible();
  await expect(page.getByText("Total Emails").first()).toBeVisible();
  await expect(page.getByText("Employee performance")).toBeVisible();

  // paste a new batch, then paste it again -> everything is an exact duplicate
  await page.goto("/import");
  const box = page.getByPlaceholder(/From: Name/);
  await box.fill(email(0) + "\n" + email(1));
  await page.getByRole("button", { name: "Analyze Emails" }).click();
  await expect(page.getByText(/Result — Batch/)).toBeVisible();
  await box.fill(email(0));
  await page.getByRole("button", { name: "Analyze Emails" }).click();
  await expect(page.getByText(/Duplicate email already exists/)).toBeVisible();

  // review: approve the first item
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "Review Required" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByText("Classification approved.")).toBeVisible();

  // emails table + detail
  await page.goto("/emails?q=Mansour");
  await page.getByRole("link", { name: "BB outage at Mansour" }).first().click();
  await expect(page.getByText("Audit history")).toBeVisible();

  // report + Excel export
  await page.goto("/reports");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export Excel" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
});
