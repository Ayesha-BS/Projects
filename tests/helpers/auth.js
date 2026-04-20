const { expect } = require("@playwright/test");

async function loginLinkedIn(page, email, password) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  await page.getByLabel(/email|phone/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page).toHaveURL(/linkedin\.com/);
}

module.exports = { loginLinkedIn };
