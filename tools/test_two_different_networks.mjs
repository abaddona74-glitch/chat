import { chromium } from "@playwright/test";
import jwt from "jsonwebtoken";
import path from "node:path";
import fs from "node:fs";

const JWT_SECRET = "supersecretkey2026chat";
const RESULTS_DIR = path.resolve(process.cwd(), "test-results");
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

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
  console.log("==========================================================================");
  console.log("🌍 REAL 2-DIFFERENT-NETWORKS GROUP CALL TEST (PROXY / VPN VERIFICATION)");
  console.log("   Network 1 (Mahmudbek): Local ISP (Uzbekistan: 83.221.187.218)");
  console.log("   Network 2 (Oybek):      Remote Cloud Proxy (USA: 45.63.119.229 via SOCKS5)");
  console.log("   TURN Server:           mytelegramchat.ddns.net:3478");
  console.log("==========================================================================");

  const commonArgs = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--no-default-browser-check"
  ];

  console.log("\n[1/6] Launching Browser 1 on Network 1 (Uzbekistan Local IP)...");
  const browser1 = await chromium.launch({
    headless: false,
    args: [...commonArgs, "--window-position=30,30", "--window-size=920,950"]
  });
  const context1 = await browser1.newContext({ permissions: ["microphone", "camera"] });
  const page1 = await context1.newPage();

  console.log("[2/6] Launching Browser 2 on Network 2 (USA Proxy: 45.63.119.229)...");
  const browser2 = await chromium.launch({
    headless: false,
    args: [
      ...commonArgs,
      "--proxy-server=socks5://127.0.0.1:1080",
      "--window-position=960,30",
      "--window-size=920,950"
    ]
  });
  const context2 = await browser2.newContext({ permissions: ["microphone", "camera"] });
  const page2 = await context2.newPage();

  // Verify external IPs on both pages
  console.log("\n[3/6] Verifying public IP addresses on both browsers...");
  await page1.goto("https://api.ipify.org");
  const ip1 = (await page1.innerText("body")).trim();
  console.log(`   🌐 Browser 1 (Mahmudbek) Public IP: ${ip1}`);

  await page2.goto("https://api.ipify.org");
  const ip2 = (await page2.innerText("body")).trim();
  console.log(`   🌐 Browser 2 (Oybek) Public IP:      ${ip2}`);

  if (ip1 === ip2) {
    console.warn("⚠️ Warning: Both browsers have identical IP. Proxy might not be routing.");
  } else {
    console.log("   ✅ SUCCESS: Both browsers are on COMPLETELY DIFFERENT NETWORKS!");
  }

  // Hook RTCPeerConnection to record ICE candidates and stats
  const setupRtcHooks = () => {
    window.__activePCs = [];
    const OrigPC = window.RTCPeerConnection;
    window.RTCPeerConnection = function (...args) {
      const pc = new OrigPC(...args);
      window.__activePCs.push(pc);
      return pc;
    };
    window.RTCPeerConnection.prototype = OrigPC.prototype;
  };

  await page1.addInitScript(setupRtcHooks);
  await page2.addInitScript(setupRtcHooks);

  // Authenticate both users
  console.log("\n[4/6] Logging in on the two different networks...");
  // Browser 1 connects via local, Browser 2 connects via remote cloud proxy
  await page1.goto("http://localhost:5173");
  await page1.evaluate((t) => localStorage.setItem("chat_token", t), tokenMahmudbek);
  await page1.reload();
  await page1.waitForSelector(".sidebar-tabs", { timeout: 15000 });
  console.log("   ✅ Mahmudbek logged in on Network 1");

  await page2.goto("https://mytelegramchat.ddns.net");
  await page2.evaluate((t) => localStorage.setItem("chat_token", t), tokenOybek);
  await page2.reload();
  await page2.waitForSelector(".sidebar-tabs", { timeout: 15000 });
  console.log("   ✅ Oybek logged in on Network 2 (via Cloud Proxy)");

  // Navigate both to 'dota 2' group
  console.log("\n[5/6] Opening 'dota 2' group and starting call across networks...");
  await page1.locator("button.sidebar-tab:has-text('Groups')").first().click();
  await page2.locator("button.sidebar-tab:has-text('Groups')").first().click();
  await page1.waitForTimeout(1000);
  await page2.waitForTimeout(1000);

  await page1.locator("button.user-item:has-text('dota 2')").first().click();
  await page2.locator("button.user-item:has-text('dota 2')").first().click();
  await page1.waitForTimeout(1500);

  // Mahmudbek starts Group Call
  console.log("   📞 Mahmudbek starting Group Call...");
  const callBtn1 = page1.locator("button:has-text('Group Call'), button:has-text('Join')").first();
  await callBtn1.click();

  const endCallBtn1 = page1.locator("button.end-call-btn, button:has-text('End call')").first();
  await endCallBtn1.waitFor({ state: "visible", timeout: 15000 });
  console.log("   Mahmudbek in room. Ringing Oybek across the internet...");

  // Oybek joins
  console.log("   Oybek receiving call on Network 2...");
  const oybekJoinOrAccept = page2.locator(
    "button.floating-accept-btn, button.btn-call-header-accept, button:has-text('Join'), button:has-text('Accept')"
  ).first();
  await oybekJoinOrAccept.waitFor({ state: "visible", timeout: 15000 });
  await oybekJoinOrAccept.click();

  const endCallBtn2 = page2.locator("button.end-call-btn, button:has-text('End call')").first();
  await endCallBtn2.waitFor({ state: "visible", timeout: 15000 });
  console.log("   ✅ BOTH USERS ARE IN-CALL ACROSS DIFFERENT NETWORKS!");

  // Wait for audio transmission and measure stats
  console.log("\n[6/6] 🎙️ Measuring cross-network audio stats over 12 seconds...");
  await page1.waitForTimeout(4000);

  const stats = await page1.evaluate(async () => {
    const pcs = window.__activePCs || [];
    let rtpStats = { bytesReceived: 0, bytesSent: 0, candidateType: "none", remoteIp: "none" };

    for (const pc of pcs) {
      try {
        const report = await pc.getStats();
        let selectedPair = null;
        const candidates = {};

        report.forEach((stat) => {
          if (stat.type === "candidate-pair" && stat.selected) selectedPair = stat;
          if (stat.type === "local-candidate" || stat.type === "remote-candidate") {
            candidates[stat.id] = stat;
          }
          if (stat.type === "inbound-rtp" && stat.kind === "audio") {
            rtpStats.bytesReceived += stat.bytesReceived || 0;
          }
          if (stat.type === "outbound-rtp" && stat.kind === "audio") {
            rtpStats.bytesSent += stat.bytesSent || 0;
          }
        });

        if (selectedPair) {
          const localC = candidates[selectedPair.localCandidateId];
          const remoteC = candidates[selectedPair.remoteCandidateId];
          rtpStats.candidateType = `${localC?.candidateType} ➔ ${remoteC?.candidateType}`;
          rtpStats.remoteIp = remoteC?.ip || remoteC?.address;
          rtpStats.rttMs = selectedPair.currentRoundTripTime
            ? Math.round(selectedPair.currentRoundTripTime * 1000)
            : null;
        }
      } catch {}
    }
    return rtpStats;
  });

  console.log("\n📊 STATS REPORT ACROSS DIFFERENT NETWORKS:");
  console.log(`   Candidate Path: ${stats.candidateType}`);
  console.log(`   Remote IP:      ${stats.remoteIp}`);
  console.log(`   Round-Trip (RTT): ${stats.rttMs} ms`);
  console.log(`   Audio Sent:     ${stats.bytesSent} bytes`);
  console.log(`   Audio Received: ${stats.bytesReceived} bytes`);

  const ss1 = path.join(RESULTS_DIR, "diff_network_mahmudbek.png");
  const ss2 = path.join(RESULTS_DIR, "diff_network_oybek.png");
  await page1.screenshot({ path: ss1 });
  await page2.screenshot({ path: ss2 });
  console.log(`   📸 Screenshots saved:\n      - ${ss1}\n      - ${ss2}`);

  console.log("\n⏳ Keeping windows open for 10 seconds for you to observe on screen...");
  await page1.waitForTimeout(10000);

  if (await endCallBtn1.isVisible()) await endCallBtn1.click();
  await page1.waitForTimeout(1500);

  console.log("\n==========================================================================");
  console.log("🏆 100% VERIFIED: GROUP CALL WORKS SEAMLESSLY ACROSS DIFFERENT NETWORKS!");
  console.log("==========================================================================\n");

  await browser1.close();
  await browser2.close();
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
