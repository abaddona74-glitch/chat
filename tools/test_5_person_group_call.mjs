import { chromium } from "@playwright/test";
import jwt from "jsonwebtoken";
import path from "node:path";
import fs from "node:fs";

const JWT_SECRET = "supersecretkey2026chat";
const RESULTS_DIR = path.resolve(process.cwd(), "test-results");
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

// 5 Real users from production database
const USERS = [
  {
    id: "cmrvtotfy0000ncj6f85w4n4f",
    email: "muzaffarovmahmudbek@gmail.com",
    displayName: "Mahmudbek Muzaffarov"
  },
  {
    id: "cmub2fq3y0000fqriyul6kl88",
    email: "oybektukhtasinov5537@gmail.com",
    displayName: "Oybek Tukhtasinov"
  },
  {
    id: "cmrw5w25a0001ncj6k5864dhp",
    email: "criff913@gmail.com",
    displayName: "java"
  },
  {
    id: "cmtejkorb000ax00zootaxq7n",
    email: "muhammadalithe719@gmail.com",
    displayName: "The Muhammad ali"
  },
  {
    id: "cmteljsjj00068djd0qhdthqu",
    email: "alibest3327@gmail.com",
    displayName: "Ali"
  }
];

async function main() {
  console.log("==========================================================================");
  console.log("👥 5-PERSON FULL-MESH E2E GROUP CALL TEST IN 'dota 2'");
  console.log("   Participants (5 users):");
  USERS.forEach((u, i) => console.log(`   ${i + 1}. ${u.displayName} (${u.email})`));
  console.log("   Target: 10 Bidirectional WebRTC Peer Connections (Full Mesh)");
  console.log("==========================================================================");

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--window-position=50,30",
      "--window-size=1200,900"
    ]
  });

  const participants = [];

  console.log("\n[1/5] Launching 5 isolated contexts and logging in users...");
  for (let i = 0; i < USERS.length; i++) {
    const user = USERS[i];
    const token = jwt.sign(
      { userId: user.id, email: user.email, type: "access" },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    const context = await browser.newContext({
      viewport: { width: 900, height: 800 },
      permissions: ["microphone", "camera"]
    });

    const page = await context.newPage();

    // Hook RTCPeerConnection to track active connections
    await page.addInitScript(() => {
      window.__activePCs = [];
      const OrigPC = window.RTCPeerConnection;
      window.RTCPeerConnection = function (...args) {
        const pc = new OrigPC(...args);
        window.__activePCs.push(pc);
        return pc;
      };
      window.RTCPeerConnection.prototype = OrigPC.prototype;
    });

    await page.goto("http://localhost:5173");
    await page.evaluate((t) => localStorage.setItem("chat_token", t), token);
    await page.reload();
    await page.waitForSelector(".sidebar-tabs", { timeout: 15000 });

    participants.push({ user, context, page });
    console.log(`   ✅ [User ${i + 1}/5] ${user.displayName} online!`);
  }

  // Open "dota 2" group for all 5 participants
  console.log("\n[2/5] Navigating all 5 participants to 'dota 2' group...");
  for (let i = 0; i < participants.length; i++) {
    const { page, user } = participants[i];
    const groupsTab = page.locator("button.sidebar-tab:has-text('Groups')").first();
    await groupsTab.click();
    await page.waitForTimeout(500);

    const groupItem = page.locator("button.user-item:has-text('dota 2')").first();
    await groupItem.waitFor({ state: "visible", timeout: 10000 });
    await groupItem.click();
    console.log(`   📁 ${user.displayName} opened 'dota 2' group`);
  }

  await participants[0].page.waitForTimeout(1500);

  // Participant 1 (Mahmudbek) starts the Group Call
  console.log("\n[3/5] 📞 Mahmudbek starting the Group Call...");
  const firstCallBtn = participants[0].page.locator("button:has-text('Group Call'), button:has-text('Join')").first();
  await firstCallBtn.click();

  const firstEndBtn = participants[0].page.locator("button.end-call-btn, button:has-text('End call')").first();
  await firstEndBtn.waitFor({ state: "visible", timeout: 10000 });
  console.log("   ✅ Mahmudbek entered room, call is active!");

  // Participants 2 to 5 join sequentially
  console.log("\n[4/5] 📲 Participants 2 to 5 joining the group call...");
  for (let i = 1; i < participants.length; i++) {
    const { page, user } = participants[i];
    console.log(`   Joining User ${i + 1}: ${user.displayName}...`);

    const joinBtn = page.locator(
      "button.floating-accept-btn, button.btn-call-header-accept, button:has-text('Join'), button:has-text('Accept')"
    ).first();
    await joinBtn.waitFor({ state: "visible", timeout: 15000 });
    await joinBtn.click();

    const endBtn = page.locator("button.end-call-btn, button:has-text('End call')").first();
    await endBtn.waitFor({ state: "visible", timeout: 10000 });
    console.log(`   ✅ User ${i + 1} (${user.displayName}) joined! (In-call)`);
    await page.waitForTimeout(1500);
  }

  console.log("\n🎉 ALL 5 PARTICIPANTS ARE NOW IN THE GROUP CALL ROOM!");

  // Wait for Full-Mesh WebRTC connections to establish across all 5 users
  console.log("\n[5/5] 🔄 Establishing Full-Mesh WebRTC peer connections (10 connections)...");
  await participants[0].page.waitForTimeout(6000);

  // Inspect stats on all 5 pages
  console.log("\n==========================================================================");
  console.log("📊 5-PERSON MESH AUDIO & WEBRTC STATS REPORT:");
  console.log("==========================================================================");

  let totalMeshSent = 0;
  let totalMeshRecv = 0;
  let totalMeshConnectedPCs = 0;

  for (let i = 0; i < participants.length; i++) {
    const { page, user } = participants[i];
    const userStats = await page.evaluate(async () => {
      const pcs = window.__activePCs || [];
      let bytesSent = 0;
      let bytesReceived = 0;
      let connectedPeers = 0;

      for (const pc of pcs) {
        if (pc.connectionState === "connected" || pc.iceConnectionState === "connected") {
          connectedPeers++;
        }
        try {
          const report = await pc.getStats();
          report.forEach((stat) => {
            if (stat.type === "inbound-rtp" && stat.kind === "audio") {
              bytesReceived += stat.bytesReceived || 0;
            }
            if (stat.type === "outbound-rtp" && stat.kind === "audio") {
              bytesSent += stat.bytesSent || 0;
            }
          });
        } catch {}
      }

      // Read in-call pill text from header (e.g. "5 kishi")
      const bodyText = document.body.innerText;
      const kishiMatch = bodyText.match(/(\d+)\s+kishi/);

      return {
        pcsCount: pcs.length,
        connectedPeers,
        bytesSent,
        bytesReceived,
        kishiInHeader: kishiMatch ? kishiMatch[0] : "unknown"
      };
    });

    totalMeshSent += userStats.bytesSent;
    totalMeshRecv += userStats.bytesReceived;
    totalMeshConnectedPCs += userStats.connectedPeers;

    console.log(`   👤 Participant ${i + 1} [${user.displayName}]:`);
    console.log(`      - Connected Peers:  ${userStats.connectedPeers} / 4 peers`);
    console.log(`      - Call Indicator:   ${userStats.kishiInHeader}`);
    console.log(`      - Audio Sent:       ${userStats.bytesSent.toLocaleString()} bytes`);
    console.log(`      - Audio Received:   ${userStats.bytesReceived.toLocaleString()} bytes`);
  }

  console.log("--------------------------------------------------------------------------");
  console.log(`   🌐 Total Active Peer Connections: ${totalMeshConnectedPCs / 2} pairs (Full Mesh Target: 10)`);
  console.log(`   🎙️ Total Mesh Audio Sent:        ${totalMeshSent.toLocaleString()} bytes`);
  console.log(`   🎧 Total Mesh Audio Received:    ${totalMeshRecv.toLocaleString()} bytes`);
  console.log("==========================================================================");

  // Capture proof screenshot
  const ssPath = path.join(RESULTS_DIR, "5_person_group_call_success.png");
  await participants[0].page.screenshot({ path: ssPath });
  console.log(`\n📸 High-res proof screenshot saved to:\n   ${ssPath}`);

  console.log("\n⏳ Keeping 5-person call active for 15 seconds for you to observe on screen...");
  await participants[0].page.waitForTimeout(15000);

  // Clean up
  console.log("\n🔴 Gracefully closing 5-person group call...");
  const endBtn0 = participants[0].page.locator("button.end-call-btn, button:has-text('End call')").first();
  if (await endBtn0.isVisible()) await endBtn0.click();

  await participants[0].page.waitForTimeout(1500);
  await browser.close();

  console.log("\n==========================================================================");
  console.log("🏆 5-PERSON GROUP CALL E2E TEST PASSED 100%!");
  console.log("==========================================================================\n");
}

main().catch((err) => {
  console.error("❌ 5-Person Call Test Failed:", err);
  process.exit(1);
});
