import { chromium } from "@playwright/test";
import jwt from "jsonwebtoken";

const JWT_SECRET = "supersecretkey2026chat";

// Oybek's credentials
const OYBEK = {
  id: "cmub2fq3y0000fqriyul6kl88",
  email: "oybektukhtasinov5537@gmail.com",
  displayName: "Oybek Tukhtasinov"
};

// Mahmudbek's credentials
const MAHMUDBEK = {
  id: "cmrvtotfy0000ncj6f85w4n4f",
  email: "muzaffarovmahmudbek@gmail.com",
  displayName: "Mahmudbek Muzaffarov"
};

const tokenOybek = jwt.sign(
  { userId: OYBEK.id, email: OYBEK.email, type: "access" },
  JWT_SECRET,
  { expiresIn: "1d" }
);

async function main() {
  console.log("==================================================================");
  console.log("📞 INITIATING DIRECT CALL: Oybek Tukhtasinov ➔ Mahmudbek Muzaffarov");
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

  console.log("\n[1/5] Oybek akkauntiga kirilmoqda...");
  await page.goto("http://localhost:5173");
  await page.evaluate((t) => localStorage.setItem("chat_token", t), tokenOybek);
  await page.reload();

  await page.waitForSelector(".sidebar-tabs", { timeout: 15000 });
  console.log("   ✅ Oybek online bo'ldi!");

  // Select Mahmudbek Muzaffarov from direct contacts
  console.log("\n[2/5] Kontaktlar orasidan Mahmudbek Muzaffarov tanlanmoqda...");
  const contactsTab = page.locator("button.sidebar-tab:has-text('Contacts')").first();
  await contactsTab.click();
  await page.waitForTimeout(1000);

  const mahmudbekContact = page.locator("button.user-item:has-text('Mahmudbek')").first();
  await mahmudbekContact.waitFor({ state: "visible", timeout: 10000 });
  await mahmudbekContact.click();
  console.log("   ✅ Mahmudbek bilan chat ochildi!");

  await page.waitForTimeout(1500);

  // Inject melody audio player into Oybek's stream so Mahmudbek hears distinct pleasant tones
  await page.evaluate(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      gain.gain.setValueAtTime(0.3, ctx.currentTime);

      // Play repeating cheerful melody: C4, E4, G4, C5, G4, E4
      const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63];
      let t = ctx.currentTime;
      for (let round = 0; round < 60; round++) {
        for (const n of notes) {
          osc.frequency.setValueAtTime(n, t);
          t += 0.35;
        }
        t += 0.5; // pause between phrases
      }
      osc.connect(gain);
      osc.start();

      const dest = ctx.createMediaStreamDestination();
      gain.connect(dest);
      window.__customAudioTrack = dest.stream.getAudioTracks()[0];
      console.log("🎵 Synthetic melody generator active!");
    } catch (e) {
      console.error("Melody error:", e);
    }
  });

  // Click Call button
  console.log("\n[3/5] 📞 Mahmudbekka qo'ng'iroq qilinmoqda (Call bosildi)...");
  const callBtn = page.locator("button:has-text('Call')").first();
  await callBtn.waitFor({ state: "visible", timeout: 10000 });
  await callBtn.click();

  console.log("   🔔 QO'NG'IROQ YUBORILDI! Desktop ilovangizda 'Accept' (Qabul qilish) tugmasini bosing!");
  console.log("   (Mahmudbekning ekranda qo'ng'iroq chaqiruvi jiringlamoqda...)");

  // Wait for Mahmudbek to accept the call
  const endCallBtn = page.locator("button.end-call-btn, button:has-text('End call')").first();
  await endCallBtn.waitFor({ state: "visible", timeout: 45000 });
  console.log("\n[4/5] 🟢 QO'NG'IROQ ULINDI! Ikkala tomon hozir GAPLASHMOQDA (IN-CALL)!");

  // Hook up incoming audio analyzer to track Mahmudbek's speech
  await page.evaluate(() => {
    const audio = document.querySelector("audio");
    if (!audio || !audio.srcObject) return;

    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(audio.srcObject);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      window.__getMahmudbekVoiceVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        return Math.round((avg / 255) * 100);
      };
    } catch (err) {
      console.error("Analyser init error:", err);
    }
  });

  console.log("\n[5/5] 🎙️ OVOZ TESTI BOSHLANDI:");
  console.log("   👉 1. Sizga Oybekdan kuy/ovoz (audio stream) bormoqda, karnay/naushnikni tinglang!");
  console.log("   👉 2. Mikrofoningizga gapiring ('Salom', 'Eshitilyaptimi?')...");
  console.log("   (Test 60 soniya davom etadi yoki o'zingiz 'End call' qilishingiz mumkin)\n");

  const startTime = Date.now();
  let totalSpeakingFrames = 0;

  while (Date.now() - startTime < 60000) {
    if (!(await endCallBtn.isVisible())) {
      console.log("   ℹ️ Qo'ng'iroq yakunlandi.");
      break;
    }

    const volume = await page.evaluate(() => {
      if (typeof window.__getMahmudbekVoiceVolume === "function") {
        return window.__getMahmudbekVoiceVolume();
      }
      return 0;
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (volume > 5) {
      totalSpeakingFrames++;
      console.log(`   🗣️ [${elapsed}s] MAHMUDBEK GAPIRYAPTI! Mikrofon balandligi: ${volume}%`);
    } else {
      process.stdout.write(`\r   ⏳ [${elapsed}s] Tinglanmoqda... (Oybek sizni eshitmoqda, mikrofon balandligi: ${volume}%)  `);
    }

    await page.waitForTimeout(800);
  }

  console.log("\n\n==================================================================");
  console.log("🏁 TEST YAKUNLANDI!");
  console.log(`   Mahmudbekdan qabul qilingan faol ovoz signallari: ${totalSpeakingFrames} marta`);
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
