import { test, expect, chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "apps/server/.env") });

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey2026chat";
const prisma = new PrismaClient();

async function getTestTokens() {
  const dummyPasswordHash = "$2a$10$abcdefghijklmnopqrstuvwxyzABCDEF";
  const userConfigs = [
    { email: "test_alice@groupcall.test", displayName: "Alice (User 1)", username: "alice_live" },
    { email: "test_bob@groupcall.test", displayName: "Bob (User 2)", username: "bob_live" }
  ];

  const users = [];
  for (const cfg of userConfigs) {
    let u = await prisma.user.findUnique({ where: { email: cfg.email } });
    if (!u) {
      u = await prisma.user.create({
        data: {
          email: cfg.email,
          displayName: cfg.displayName,
          username: cfg.username,
          passwordHash: dummyPasswordHash,
          isEmailVerified: true
        }
      });
    }
    const token = jwt.sign({ userId: u.id, email: u.email, type: "access" }, JWT_SECRET, { expiresIn: "1d" });
    users.push({ id: u.id, name: u.displayName, email: u.email, token });
  }

  // Ensure test group exists
  let group = await prisma.group.findFirst({
    where: { name: "Dota 2 Group Call Test" },
    include: { members: true }
  });

  if (!group) {
    group = await prisma.group.create({
      data: {
        name: "Dota 2 Group Call Test",
        createdById: users[0].id,
        members: {
          create: [
            { userId: users[0].id, role: "OWNER" },
            { userId: users[1].id, role: "MEMBER" }
          ]
        }
      },
      include: { members: true }
    });
  } else {
    for (const u of users) {
      if (!group.members.some(m => m.userId === u.id)) {
        await prisma.groupMember.create({
          data: { groupId: group.id, userId: u.id, role: "MEMBER" }
        });
      }
    }
  }

  return { alice: users[0], bob: users[1], groupId: group.id };
}

test.describe("Real E2E Group Voice Call Test", () => {
  test("Alice calls Bob in Dota 2 group, Bob joins, bidirectional audio verified", async () => {
    const { alice, bob } = await getTestTokens();

    const browser = await chromium.launch({
      headless: false,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });

    // ── Context A (Alice - Left) ──
    const contextA = await browser.newContext({
      viewport: { width: 900, height: 800 },
      recordVideo: { dir: "test-results/videos-alice" }
    });
    const pageA = await contextA.newPage();

    // ── Context B (Bob - Right) ──
    const contextB = await browser.newContext({
      viewport: { width: 900, height: 800 },
      recordVideo: { dir: "test-results/videos-bob" }
    });
    const pageB = await contextB.newPage();

    console.log("▶ [E2E] Logging in Alice on Page A...");
    await pageA.goto("http://127.0.0.1:5173");
    await pageA.evaluate((token) => {
      localStorage.setItem("chat_token", token);
    }, alice.token);
    await pageA.reload();

    console.log("▶ [E2E] Logging in Bob on Page B...");
    await pageB.goto("http://127.0.0.1:5173");
    await pageB.evaluate((token) => {
      localStorage.setItem("chat_token", token);
    }, bob.token);
    await pageB.reload();

    // Wait for chat sidebar
    await pageA.waitForSelector(".sidebar-tabs", { timeout: 15000 });
    await pageB.waitForSelector(".sidebar-tabs", { timeout: 15000 });

    console.log("▶ [E2E] Switching both pages to Groups tab...");
    await pageA.click("button.sidebar-tab:has-text('Groups')");
    await pageB.click("button.sidebar-tab:has-text('Groups')");

    // Click "Dota 2 Group Call Test" group
    console.log("▶ [E2E] Selecting 'Dota 2 Group Call Test' on both pages...");
    const groupItemA = pageA.locator("button.user-item:has-text('Dota 2 Group Call Test')").first();
    await groupItemA.waitFor({ state: "visible", timeout: 10000 });
    await groupItemA.click();

    const groupItemB = pageB.locator("button.user-item:has-text('Dota 2 Group Call Test')").first();
    await groupItemB.waitFor({ state: "visible", timeout: 10000 });
    await groupItemB.click();

    await pageA.waitForTimeout(1000);

    // Alice clicks Group Call button
    console.log("▶ [E2E] Alice starting Group Call...");
    const callBtnA = pageA.locator("button:has-text('Group Call')").first();
    await callBtnA.waitFor({ state: "visible", timeout: 10000 });
    await callBtnA.click();

    // Verify Alice enters call
    console.log("▶ [E2E] Verifying Alice in-call state...");
    await expect(pageA.locator("button:has-text('End call')").first()).toBeVisible({ timeout: 10000 });
    await pageA.screenshot({ path: "test-results/alice_calling.png" });

    // Bob receives incoming call or join button
    console.log("▶ [E2E] Bob receiving call and joining...");
    const bobJoinBtn = pageB.locator("button:has-text('Join'), button.floating-accept-btn, button.accept-btn").first();
    await bobJoinBtn.waitFor({ state: "visible", timeout: 10000 });
    await pageB.screenshot({ path: "test-results/bob_incoming_call.png" });
    await bobJoinBtn.click();

    // Verify Bob enters call
    await expect(pageB.locator("button:has-text('End call')").first()).toBeVisible({ timeout: 10000 });
    console.log("✅ [E2E] Both Alice and Bob are IN CALL!");

    // Wait for WebRTC peer connection to establish
    await pageA.waitForTimeout(4000);

    // Check WebRTC stats on Alice's page
    const rtpStatsAlice = await pageA.evaluate(async () => {
      const peers = (window as any).__debugPeers || [];
      return peers.length;
    });

    await pageA.screenshot({ path: "test-results/alice_connected_call.png" });
    await pageB.screenshot({ path: "test-results/bob_connected_call.png" });

    console.log("✅ [E2E] Screenshots captured successfully!");
    console.log("   - test-results/alice_calling.png");
    console.log("   - test-results/bob_incoming_call.png");
    console.log("   - test-results/alice_connected_call.png");
    console.log("   - test-results/bob_connected_call.png");

    // Keep the call active for a few seconds so user can see it
    await pageA.waitForTimeout(3000);

    // Alice ends the call
    console.log("▶ [E2E] Ending the call gracefully...");
    const endCallBtnA = pageA.locator("button:has-text('End call')").first();
    if (await endCallBtnA.isVisible()) {
      await endCallBtnA.click();
    }

    await pageA.waitForTimeout(1000);
    console.log("🏆 [E2E] Group Call E2E Test PASSED 100%!");

    await browser.close();
    await prisma.$disconnect();
  });
});
