import { test, expect } from '@playwright/test';

test.describe("Layer 3: Student Editor Route Guard & Interface Security", () => {
  test("Layer 3: Student Editor Route Guard & Interface Security", async ({ page }) => {
    // Base URL navigation
    await page.goto("http://localhost:3000/editor");

    await test.step("navigate to http://localhost:3000/editor", async () => {
      await page.goto("http://localhost:3000/editor");
    });

    await test.step("verify path '/login'", async () => {
      await expect(page).toHaveURL(new RegExp("\\/login", ""));
    });

    await test.step("verify 'Welcome to Clio' is visible", async () => {
      await expect(page.getByText("Welcome to Clio").first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("verify 'Login' is visible", async () => {
      await expect(page.getByText("Login").first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("type 'student' into 'username'", async () => {
      const inputEl = page.getByLabel(new RegExp("username", "i"))
        .or(page.getByPlaceholder(new RegExp("username", "i")))
        .or(page.locator("input[name*=\"username\" i], textarea[name*=\"username\" i]"));
      await inputEl.first().fill("student");
    });

    await test.step("type 'test' into 'password'", async () => {
      const inputEl = page.getByLabel(new RegExp("password", "i"))
        .or(page.getByPlaceholder(new RegExp("password", "i")))
        .or(page.locator("input[name*=\"password\" i], textarea[name*=\"password\" i]"));
      await inputEl.first().fill("test");
    });

    await test.step("click 'Login'", async () => {
      const clickTarget = page.getByRole('button', { name: new RegExp("Login", "i") })
        .or(page.getByRole('link', { name: new RegExp("Login", "i") }))
        .or(page.getByText("Login"));
      await clickTarget.first().click();
    });

    await test.step("verify 'Invalid credentials' is visible", async () => {
      await expect(page.getByText("Invalid credentials").first()).toBeVisible({ timeout: 5000 });
    });

  });
});
