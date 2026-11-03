import { test, expect } from '@playwright/test';

test.describe("Layer 1: Route Navigation & Landing Page Flow", () => {
  test("Layer 1: Route Navigation & Landing Page Flow", async ({ page }) => {
    // Base URL navigation
    await page.goto("http://localhost:3000");

    await test.step("navigate to http://localhost:3000/", async () => {
      await page.goto("http://localhost:3000/");
    });

    await test.step("verify \"Let's Go\" is visible", async () => {
      await expect(page.getByText("Let").first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("click \"Let's Go\"", async () => {
      const clickTarget = page.getByRole('button', { name: new RegExp("Let's Go", "i") })
        .or(page.getByRole('link', { name: new RegExp("Let's Go", "i") }))
        .or(page.getByText("Let's Go"));
      await clickTarget.first().click();
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

    await test.step("click 'Register'", async () => {
      const clickTarget = page.getByRole('button', { name: new RegExp("Register", "i") })
        .or(page.getByRole('link', { name: new RegExp("Register", "i") }))
        .or(page.getByText("Register"));
      await clickTarget.first().click();
    });

    await test.step("verify path '/register'", async () => {
      await expect(page).toHaveURL(new RegExp("\\/register", ""));
    });

    await test.step("verify 'Create Account' is visible", async () => {
      await expect(page.getByText("Create Account").first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("click 'Back to Login'", async () => {
      const clickTarget = page.getByRole('button', { name: new RegExp("Back to Login", "i") })
        .or(page.getByRole('link', { name: new RegExp("Back to Login", "i") }))
        .or(page.getByText("Back to Login"));
      await clickTarget.first().click();
    });

    await test.step("verify path '/login'", async () => {
      await expect(page).toHaveURL(new RegExp("\\/login", ""));
    });

  });
});
