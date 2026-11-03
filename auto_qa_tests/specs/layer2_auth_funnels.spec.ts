import { test, expect } from '@playwright/test';

test.describe("Layer 2: Authentication Funnels & Teacher Invite Code Gate", () => {
  test("Layer 2: Authentication Funnels & Teacher Invite Code Gate", async ({ page }) => {
    // Base URL navigation
    await page.goto("http://localhost:3000/register");

    await test.step("navigate to http://localhost:3000/register", async () => {
      await page.goto("http://localhost:3000/register");
    });

    await test.step("verify 'Create Account' is visible", async () => {
      await expect(page.getByText("Create Account").first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("click 'Create Account'", async () => {
      const clickTarget = page.getByRole('button', { name: new RegExp("Create Account", "i") })
        .or(page.getByRole('link', { name: new RegExp("Create Account", "i") }))
        .or(page.getByText("Create Account"));
      await clickTarget.first().click();
    });

    await test.step("verify 'Username, email, and password are required' is visible", async () => {
      await expect(page.getByText("Username, email, and password are required").first()).toBeVisible({ timeout: 5000 });
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

    await test.step("type 'testteacher' into 'username'", async () => {
      const inputEl = page.getByLabel(new RegExp("username", "i"))
        .or(page.getByPlaceholder(new RegExp("username", "i")))
        .or(page.locator("input[name*=\"username\" i], textarea[name*=\"username\" i]"));
      await inputEl.first().fill("testteacher");
    });

    await test.step("type 'Test Teacher' into 'fullName'", async () => {
      const inputEl = page.getByLabel(new RegExp("fullName", "i"))
        .or(page.getByPlaceholder(new RegExp("fullName", "i")))
        .or(page.locator("input[name*=\"fullName\" i], textarea[name*=\"fullName\" i]"));
      await inputEl.first().fill("Test Teacher");
    });

    await test.step("type 'teacher@test.edu' into 'email'", async () => {
      const inputEl = page.getByLabel(new RegExp("email", "i"))
        .or(page.getByPlaceholder(new RegExp("email", "i")))
        .or(page.locator("input[name*=\"email\" i], textarea[name*=\"email\" i]"));
      await inputEl.first().fill("teacher@test.edu");
    });

    await test.step("type 'FACULTY_CODE' into 'inviteCode'", async () => {
      const inputEl = page.getByLabel(new RegExp("inviteCode", "i"))
        .or(page.getByPlaceholder(new RegExp("inviteCode", "i")))
        .or(page.locator("input[name*=\"inviteCode\" i], textarea[name*=\"inviteCode\" i]"));
      await inputEl.first().fill("FACULTY_CODE");
    });

    await test.step("type 'password123' into 'password'", async () => {
      const inputEl = page.getByLabel(new RegExp("password", "i"))
        .or(page.getByPlaceholder(new RegExp("password", "i")))
        .or(page.locator("input[name*=\"password\" i], textarea[name*=\"password\" i]"));
      await inputEl.first().fill("password123");
    });

    await test.step("type 'mismatch456' into 'confirmPassword'", async () => {
      const inputEl = page.getByLabel(new RegExp("confirmPassword", "i"))
        .or(page.getByPlaceholder(new RegExp("confirmPassword", "i")))
        .or(page.locator("input[name*=\"confirmPassword\" i], textarea[name*=\"confirmPassword\" i]"));
      await inputEl.first().fill("mismatch456");
    });

    await test.step("click 'Create Account'", async () => {
      const clickTarget = page.getByRole('button', { name: new RegExp("Create Account", "i") })
        .or(page.getByRole('link', { name: new RegExp("Create Account", "i") }))
        .or(page.getByText("Create Account"));
      await clickTarget.first().click();
    });

    await test.step("verify 'Passwords do not match' is visible", async () => {
      await expect(page.getByText("Passwords do not match").first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("navigate to http://localhost:3000/login", async () => {
      await page.goto("http://localhost:3000/login");
    });

    await test.step("type 'nonexistent_user' into 'username'", async () => {
      const inputEl = page.getByLabel(new RegExp("username", "i"))
        .or(page.getByPlaceholder(new RegExp("username", "i")))
        .or(page.locator("input[name*=\"username\" i], textarea[name*=\"username\" i]"));
      await inputEl.first().fill("nonexistent_user");
    });

    await test.step("type 'wrongpass' into 'password'", async () => {
      const inputEl = page.getByLabel(new RegExp("password", "i"))
        .or(page.getByPlaceholder(new RegExp("password", "i")))
        .or(page.locator("input[name*=\"password\" i], textarea[name*=\"password\" i]"));
      await inputEl.first().fill("wrongpass");
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
