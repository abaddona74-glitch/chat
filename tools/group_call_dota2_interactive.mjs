import { chromium } from "@playwright/test";
import jwt from "jsonwebtoken";

const JWT_SECRET = "supersecretkey2026chat";

// Oybek's credentials
const OYBEK = {
  id: "cmub2fq3y0000fqriyul6kl88",
  email: "oybektukhtasinov5537@gmail.com",
  displayName: "Oybek Tukhtasinov"
};

const MAHMUDBEK_ID = "cmrvtotfy0000ncj6f85w4n4f";

const tokenOybek = jwt.sign(
  { userId: OYBEK.id, email: OYBEK.email, type: "access" },
  JWT_SECRET,
  { expiresIn: "1d" }
);

async function main() {
  console.log("==================================================================");
  console.log("🎮 STARTING GROUP CALL IN 'dota 2': Oybek ➔ Mahmudbek");
  console.log("==================================================================");

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--window-position=1150,50",
      "--window-size=750,900"
    ]
  });

  const context = await browser.newContext({
    permissions: ["microphone", "camera"]
  });
  const page = await context.newPage();

  // Monkey-patch RTCPeerConnection before page loads so we can track peer connections
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

  console.log("\n[1/5] Oybek akkauntiga kirilmoqda...");
  await page.goto("http://localhost:5173");
  await page.evaluate((t) => localStorage.setItem("chat_token", t), tokenOybek);
  await page.reload();

  await page.waitForSelector(".sidebar-tabs", { timeout: 15000 });
  console.log("   ✅ Oybek online!");

  // Navigate to Groups tab
  console.log("\n[2/5] 'Groups' bo'limi va 'dota 2' guruhi ochilmoqda...");
  const groupsTab = page.locator("button.sidebar-tab:has-text('Groups')").first();
  await groupsTab.click();
  await page.waitForTimeout(1000);

  const dota2Group = page.locator("button.user-item:has-text('dota 2')").first();
  await dota2Group.waitFor({ state: "visible", timeout: 10000 });
  await dota2Group.click();
  console.log("   ✅ 'dota 2' guruhi ochildi!");

  await page.waitForTimeout(1500);

  // Monkey patch getUserMedia to inject melody tone
  await page.evaluate(() => {
    try {
      const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await origGUM(constraints);
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "triangle";
          gain.gain.setValueAtTime(0.3, ctx.currentTime);

          // Cheerful repeating melody: 440 (A4), 554 (C#5), 659 (E5), 880 (A5)
          const notes = [440, 554, 659, 880, 659, 554];
          let t = ctx.currentTime;
          for (let r = 0; r < 120; r++) {
            for (const n of notes) {
              osc.frequency.setValueAtTime(n, t);
              t += 0.35;
            }
            t += 0.5;
          }
          osc.connect(gain);
          osc.start();

          const dest = ctx.createMediaStreamDestination();
          gain.connect(dest);
          return dest.stream;
        } catch (e) {
          console.error("Melody stream err:", e);
          return stream;
        }
      };
      console.log("Melody injector active!");
    } catch (err) {
      console.error(err);
    }
  });

  // Start Group Call
  console.log("\n[3/5] 📞 Oybek 'Group Call' tugmasini bosmoqda...");
  const groupCallBtn = page.locator("button:has-text('Group Call'), button:has-text('Join')").first();
  await groupCallBtn.waitFor({ state: "visible", timeout: 10000 });
  await groupCallBtn.click();

  console.log("\n==================================================================");
  console.log("🔔 GURUH QO'NG'IROG'I BOSHLANDI!");
  console.log("👉 Mahmudbek, ilovangizda 'dota 2' guruhiga kiring va 'Join' yoki 'Accept' tugmasini bosing!");
  console.log("==================================================================\n");

  const endCallBtn = page.locator("button.end-call-btn, button:has-text('End call')").first();
  await endCallBtn.waitFor({ state: "visible", timeout: 10000 });
  console.log("   ✅ Oybek guruh qo'ng'irog'i xonasiga kirdi (in-call)");

  // Wait for Mahmudbek to join and WebRTC connection to establish
  console.log("   ⏳ Mahmudbek ulanishi kutilmoqda...");

  let isConnected = false;
  const connectTimeout = Date.now() + 60000;

  while (Date.now() < connectTimeout && !isConnected) {
    const pcStatus = await page.evaluate(() => {
      const pcs = window.__activePCs || [];
      for (const pc of pcs) {
        if (pc.connectionState === "connected") {
          return { connected: true, iceState: pc.iceConnectionState };
        }
      }
      return { connected: false, count: pcs.length };
    });

    if (pcStatus.connected) {
      isConnected = true;
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (isConnected) {
    console.log("\n[4/5] 🟢 MAHMUDBEK ULINDI! WebRTC aloqasi o'rnatildi (CONNECTED)!");
  } else {
    console.log("\n[4/5] ℹ️ WebRTC kutish vaqti tugadi yoki Mahmudbek hali ulanganicha yo'q. Kuzatuv davom etadi...");
  }

  console.log("\n[5/5] 🎙️ GURUH OVOZLI ALOQASI FAOL:");
  console.log("   🎵 1. Sizga Oybekdan musiqiy ohang bormoqda, karnay/naushnikni tinglang!");
  console.log("   🗣️ 2. Mikrofoningizga gapiring — qabul qilinayotgan paketlar pastda ko'rsatiladi!");
  console.log("   (Aloqa 60 soniya davom etadi yoki o'zingiz 'End call' qilishingiz mumkin)\n");

  const callStartTime = Date.now();
  let prevBytesReceived = 0;
  let speakingCount = 0;

  while (Date.now() - callStartTime < 60000) {
    if (!(await endCallBtn.isVisible())) {
      console.log("\nℹ️ Qo'ng'iroq yakunlandi.");
      break;
    }

    const rtpStats = await page.evaluate(async () => {
      const pcs = window.__activePCs || [];
      let totalBytesRecv = 0;
      let totalPacketsRecv = 0;
      let totalBytesSent = 0;
      let totalPacketsSent = 0;

      for (const pc of pcs) {
        try {
          const report = await pc.getStats();
          report.forEach((stat) => {
            if (stat.type === "inbound-rtp" && stat.kind === "audio") {
              totalBytesRecv += stat.bytesReceived || 0;
              totalPacketsRecv += stat.packetsReceived || 0;
            }
            if (stat.type === "outbound-rtp" && stat.kind === "audio") {
              totalBytesSent += stat.bytesSent || 0;
              totalPacketsSent += stat.packetsSent || 0;
            }
          });
        } catch {}
      }
      return { totalBytesRecv, totalPacketsRecv, totalBytesSent, totalPacketsSent };
    });

    const elapsed = Math.round((Date.now() - callStartTime) / 1000);
    const bytesDiff = rtpStats.totalBytesRecv - prevBytesReceived;
    prevBytesReceived = rtpStats.totalBytesRecv;

    if (bytesDiff > 500) {
      speakingCount++;
      console.log(
        `   🗣️ [${elapsed}s] MAHMUDBEK GAPIRYAPTI! +${bytesDiff} bayt qabul qilindi (Jami: ${rtpStats.totalBytesRecv.toLocaleString()} bayt, ${rtpStats.totalPacketsRecv} paket)`
      );
    } else {
      process.stdout.write(
        `\r   ⏳ [${elapsed}s] Tinglanmoqda... (Kelayotgan audio: ${rtpStats.totalBytesRecv.toLocaleString()} bayt | Yuborilayotgan musiqa: ${rtpStats.totalBytesSent.toLocaleString()} bayt)   `
      );
    }

    await page.waitForTimeout(1000);
  }

  console.log("\n\n==================================================================");
  console.log("🏁 GURUH QO'NG'IROG'I TESTI YAKUNLANDI!");
  console.log(`   Mahmudbekdan kelgan ovozli oqim signallari: ${speakingCount} marta qayd etildi`);
  console.log("==================================================================");

  if (await endCallBtn.isVisible()) {
    await endCallBtn.click();
  }
  await page.waitForTimeout(1000);
  await browser.close();
}

main().catch((err) => {
  console.error("❌ Xatolik:", err);
  process.exit(1);
});
