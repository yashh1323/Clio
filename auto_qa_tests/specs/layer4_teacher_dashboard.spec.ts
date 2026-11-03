import { test, expect } from '@playwright/test';

test.describe("Layer 4: Teacher Dashboard Edge Guard & Faculty Funnel", () => {
  test("Layer 4: Teacher Dashboard Edge Guard & Faculty Funnel", async ({ page }) => {
    // Base URL navigation
    await page.goto("http://localhost:3000/dashboard");

    await test.step("navigate to http://localhost:3000/dashboard", async () => {
      await page.goto("http://localhost:3000/dashboard");
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

    await test.step("click 'Teacher'", async () => {
      const clickTarget = page.getByRole('button', { name: new RegExp("Teacher", "i") })
        .or(page.getByRole('link', { name: new RegExp("Teacher", "i") }))
        .or(page.getByText("Teacher"));
      await clickTarget.first().click();
    });

    await test.step("verify 'Teacher Invite Code' is visible", async () => {
      await expect(page.getByText("Teacher Invite Code").first()).toBeVisible({ timeout: 5000 });
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
