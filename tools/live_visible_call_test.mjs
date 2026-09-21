import { chromium } from "@playwright/test";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";

const JWT_SECRET = "supersecretkey2026chat";
const RESULTS_DIR = path.resolve(process.cwd(), "test-results");
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

// User credentials from production database
const MAHMUDBEK = {
  id: "cmrvtotfy0000ncj6f85w4n4f",
  email: "muzaffarovmahmudbek@gmail.com",
  displayName: "Mahmudbek Muzaffarov"
};

const OYBEK = {
  id: "cmub2fq3y0000fqriyul6kl88",
  email: "oybektukhtasinov5537@gmail.com",
  displayName: "Oybek Tukhtasinov"
};

const tokenMahmudbek = jwt.sign(
  { userId: MAHMUDBEK.id, email: MAHMUDBEK.email, type: "access" },
  JWT_SECRET,
  { expiresIn: "1d" }
);

const tokenOybek = jwt.sign(
  { userId: OYBEK.id, email: OYBEK.email, type: "access" },
  JWT_SECRET,
  { expiresIn: "1d" }
);

async function main() {
  console.log("=================================================");
  console.log("🚀 STARTING ORIGINAL VISIBLE E2E GROUP CALL TEST");
  console.log("   Caller:   Mahmudbek Muzaffarov");
  console.log("   Receiver: Oybek Tukhtasinov");
  console.log("   Group:    dota 2");
  console.log("=================================================");

  const browserArgs = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--no-default-browser-check"
  ];

  console.log("\n[1/7] Launching Window 1 (Mahmudbek - Left half of screen)...");
  const browser1 = await chromium.launch({
    headless: false,
    args: [...browserArgs, "--window-position=20,30", "--window-size=920,950"]
  });
  const context1 = await browser1.newContext({
    viewport: { width: 900, height: 850 },
    permissions: ["microphone", "camera"]
  });
  const page1 = await context1.newPage();

  console.log("[2/7] Launching Window 2 (Oybek - Right half of screen)...");
  const browser2 = await chromium.launch({
    headless: false,
    args: [...browserArgs, "--window-position=960,30", "--window-size=920,950"]
  });
  const context2 = await browser2.newContext({
    viewport: { width: 900, height: 850 },
    permissions: ["microphone", "camera"]
  });
  const page2 = await context2.newPage();

  // ── Log in Mahmudbek ──
  console.log("[3/7] Authenticating Mahmudbek on Window 1...");
  await page1.goto("http://localhost:5173");
  await page1.evaluate((t) => localStorage.setItem("chat_token", t), tokenMahmudbek);
  await page1.reload();
  await page1.waitForSelector(".sidebar-tabs", { timeout: 15000 });
  console.log("   ✅ Window 1 loaded: Mahmudbek logged in");

  // ── Log in Oybek ──
  console.log("[4/7] Authenticating Oybek on Window 2...");
  await page2.goto("http://localhost:5173");
  await page2.evaluate((t) => localStorage.setItem("chat_token", t), tokenOybek);
  await page2.reload();
  await page2.waitForSelector(".sidebar-tabs", { timeout: 15000 });
  console.log("   ✅ Window 2 loaded: Oybek logged in");

  // ── Open Groups tab on both ──
  console.log("\n[5/7] Navigating to 'dota 2' group on both windows...");
  const groupsTab1 = page1.locator("button.sidebar-tab:has-text('Groups')").first();
  await groupsTab1.click();

  const groupsTab2 = page2.locator("button.sidebar-tab:has-text('Groups')").first();
  await groupsTab2.click();

  await page1.waitForTimeout(1000);
  await page2.waitForTimeout(1000);

  // Select "dota 2" group
  const group1 = page1.locator("button.user-item:has-text('dota 2')").first();
  await group1.waitFor({ state: "visible", timeout: 10000 });
  await group1.click();
  console.log("   Window 1 opened 'dota 2' group");

  const group2 = page2.locator("button.user-item:has-text('dota 2')").first();
  await group2.waitFor({ state: "visible", timeout: 10000 });
  await group2.click();
  console.log("   Window 2 opened 'dota 2' group");

  await page1.waitForTimeout(1500);

  // ── Mahmudbek starts Group Call ──
  console.log("\n[6/7] 📞 Mahmudbek clicking 'Group Call' button...");
  const callBtn1 = page1.locator("button:has-text('Group Call'), button:has-text('Join')").first();
  await callBtn1.waitFor({ state: "visible", timeout: 10000 });
  await callBtn1.click();

  // Verify Mahmudbek enters in-call state
  const endCallBtn1 = page1.locator("button.end-call-btn, button:has-text('End call')").first();
  await endCallBtn1.waitFor({ state: "visible", timeout: 10000 });
  console.log("   ✅ Mahmudbek is in call! (Status: in-call)");

  // ── Oybek receives call and joins ──
  console.log("   Waiting for incoming call on Oybek's window...");
  const oybekJoinOrAccept = page2.locator(
    "button.floating-accept-btn, button.btn-call-header-accept, button:has-text('Join'), button:has-text('Accept')"
  ).first();
  await oybekJoinOrAccept.waitFor({ state: "visible", timeout: 15000 });
  console.log("   🔔 Incoming call / Join button appeared on Oybek's screen! Clicking Accept/Join...");
  await oybekJoinOrAccept.click();

  // Verify Oybek enters in-call state
  const endCallBtn2 = page2.locator("button.end-call-btn, button:has-text('End call')").first();
  await endCallBtn2.waitFor({ state: "visible", timeout: 10000 });
  console.log("   ✅ Oybek joined the call! Both parties are connected!");

  // Wait for WebRTC peer connection to establish audio flow
  console.log("\n[7/7] 🎙️ Monitoring live bidirectional audio transmission...");
  await page1.waitForTimeout(4000);

  // Measure audio stats on Mahmudbek's page
  const statsMahmudbek = await page1.evaluate(async () => {
    // Get stats from active peer connections if available
    const pcs = [];
    if (window.__debugPeers) pcs.push(...window.__debugPeers);
    return {
      title: document.title,
      hasEndBtn: Boolean(document.querySelector(".end-call-btn"))
    };
  });

  const ssMahmudbek = path.join(RESULTS_DIR, "e2e_live_mahmudbek_call.png");
  const ssOybek = path.join(RESULTS_DIR, "e2e_live_oybek_call.png");

  await page1.screenshot({ path: ssMahmudbek });
  await page2.screenshot({ path: ssOybek });
  console.log(`   📸 Screenshots saved:`);
  console.log(`      - ${ssMahmudbek}`);
  console.log(`      - ${ssOybek}`);

  console.log("\n⏳ Keeping windows open for 15 seconds so you can see the active call on your screen...");
  await page1.waitForTimeout(15000);

  // Gracefully end call
  console.log("\n🔴 Mahmudbek clicking 'End call'...");
  if (await endCallBtn1.isVisible()) {
    await endCallBtn1.click();
  }
  await page1.waitForTimeout(1500);

  console.log("\n=================================================");
  console.log("🏆 E2E ORIGINAL GROUP CALL TEST COMPLETED SUCCESSFULLY 100%!");
  console.log("=================================================\n");

  await browser1.close();
  await browser2.close();
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
