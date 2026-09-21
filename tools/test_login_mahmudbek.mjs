import { chromium } from "@playwright/test";
import jwt from "jsonwebtoken";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (msg) => console.log("LOG:", msg.text()));

  const token = jwt.sign(
    {
      userId: "cmrvtotfy0000ncj6f85w4n4f",
      email: "muzaffarovmahmudbek@gmail.com",
      type: "access"
    },
    "supersecretkey2026chat",
    { expiresIn: "1d" }
  );

  await page.goto("http://localhost:5173");
  await page.evaluate((t) => localStorage.setItem("chat_token", t), token);
  await page.reload();

  await page.waitForSelector(".sidebar-tabs", { timeout: 15000 });
  console.log("SUCCESS: .sidebar-tabs found! Mahmudbek logged in!");
  const groupsTab = page.locator("button.sidebar-tab:has-text('Groups')").first();
  await groupsTab.click();
  await page.waitForTimeout(2000);
  const bodyText = await page.innerText("body");
  console.log("GROUPS IN PAGE:", bodyText.includes("dota 2") ? "Found dota 2!" : "Not found");
  await browser.close();
}

run().catch(console.error);
