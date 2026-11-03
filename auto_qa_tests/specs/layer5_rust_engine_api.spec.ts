import { test, expect } from '@playwright/test';

test.describe("Layer 5: Rust Engine Endpoints & Public Health Probe", () => {
  test("Layer 5: Rust Engine Endpoints & Public Health Probe", async ({ page }) => {
    // Base URL navigation
    await page.goto("http://127.0.0.1:8088/health");

    await test.step("navigate to http://127.0.0.1:8088/health", async () => {
      await page.goto("http://127.0.0.1:8088/health");
    });

    await test.step("verify 'clio-engine' is visible", async () => {
      await expect(page.getByText("clio-engine").first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("navigate to http://127.0.0.1:8088/metrics", async () => {
      await page.goto("http://127.0.0.1:8088/metrics");
    });

    await test.step("verify 'telemetry_audits_total' is visible", async () => {
      await expect(page.getByText("telemetry_audits_total").first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("navigate to http://localhost:3000/", async () => {
      await page.goto("http://localhost:3000/");
    });

    await test.step("verify path '/'", async () => {
      await expect(page).toHaveURL(new RegExp("\\/", ""));
    });

    await test.step("verify \"Let's Go\" is visible", async () => {
      await expect(page.getByText("Let").first()).toBeVisible({ timeout: 5000 });
    });

  });
});
