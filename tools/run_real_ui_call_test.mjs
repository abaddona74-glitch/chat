import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "apps/server/.env") });

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey2026chat";
const prisma = new PrismaClient();

async function prepareUsersAndGroup() {
  console.log("🛠️ Preparing 2 test accounts in database...");
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

  // Find or create group
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

  console.log(`✅ Test Group: "${group.name}" (id: ${group.id})`);
  console.log(`   User A: ${users[0].name} (${users[0].id})`);
  console.log(`   User B: ${users[1].name} (${users[1].id})\n`);

  return { users, groupId: group.id };
}

async function run() {
  const { users, groupId } = await prepareUsersAndGroup();

  const groupData = {
    groupId,
    userA: users[0],
    userB: users[1]
  };

  const htmlContent = fs.readFileSync(path.resolve(process.cwd(), "tools/real_ui_call_test.html"), "utf8");

  const reports = {};
  let finishPromiseResolve;
  const finishPromise = new Promise(r => { finishPromiseResolve = r; });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/" || url.pathname === "/call") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlContent);
    } else if (url.pathname === "/api/report" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          reports[data.role] = data;
          console.log(`📥 Received report from ${data.role} (Heard: ${data.stats.heard}, Bytes: ${data.stats.bytesRecv}, State: ${data.stats.webrtcState})`);

          if (reports.userA && reports.userB) {
            finishPromiseResolve(reports);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400).end();
        }
      });
    } else {
      res.writeHead(404).end("Not found");
    }
  });

  const TEST_PORT = 8877;
  await new Promise(r => server.listen(TEST_PORT, r));
  console.log(`🌐 Live test server running on http://localhost:${TEST_PORT}`);

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const dataParam = encodeURIComponent(JSON.stringify(groupData));

  const urlUserA = `http://localhost:${TEST_PORT}/call?role=userA&auto=true&data=${dataParam}`;
  const urlUserB = `http://localhost:${TEST_PORT}/call?role=userB&auto=true&data=${dataParam}`;

  const tempDirA = path.resolve(process.cwd(), "scratch/chrome_userA");
  const tempDirB = path.resolve(process.cwd(), "scratch/chrome_userB");
  fs.mkdirSync(tempDirA, { recursive: true });
  fs.mkdirSync(tempDirB, { recursive: true });

  console.log("🖥️  Opening 2 VISIBLE Chrome windows side-by-side for live visual testing...");
  console.log("   [Left Window]:  Alice (Initiator)");
  console.log("   [Right Window]: Bob (Receiver / Joiner)\n");

  const commonArgs = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--no-default-browser-check"
  ];

  // Window 1: Left
  const procA = spawn(chromePath, [
    ...commonArgs,
    `--user-data-dir=${tempDirA}`,
    "--window-position=30,60",
    "--window-size=920,880",
    urlUserA
  ]);

  // Window 2: Right
  const procB = spawn(chromePath, [
    ...commonArgs,
    `--user-data-dir=${tempDirB}`,
    "--window-position=960,60",
    "--window-size=920,880",
    urlUserB
  ]);

  console.log("⏳ Running live visual test sequence (~22 seconds)...");
  console.log("   1. User A starts call");
  console.log("   2. User B rings and joins");
  console.log("   3. User A speaks (440Hz tone) -> User B hears");
  console.log("   4. User B speaks (880Hz tone) -> User A hears");

  const timeoutTimer = setTimeout(() => {
    finishPromiseResolve({ error: "Test timed out after 35 seconds", reports });
  }, 35000);

  const finalReports = await finishPromise;
  clearTimeout(timeoutTimer);

  console.log("\n=======================================================");
  console.log("📊 REAL 2-WAY LIVE CALL AUDIO & SPEAKING REPORT");
  console.log("=======================================================");

  const a = finalReports.userA?.stats || {};
  const b = finalReports.userB?.stats || {};

  console.log(`\n1️⃣  WebRTC Connection Status:`);
  console.log(`   User A (Alice) State: ${a.webrtcState === "connected" ? "✅ CONNECTED" : a.webrtcState}`);
  console.log(`   User B (Bob)   State: ${b.webrtcState === "connected" ? "✅ CONNECTED" : b.webrtcState}`);

  console.log(`\n2️⃣  Bidirectional Audio Flow (Listen & Speak):`);
  console.log(`   User A -> User B (Alice gapirdi, Bob eshitdi):`);
  console.log(`      Bob Bytes Received: ${b.bytesRecv} bytes`);
  console.log(`      Bob Audio RMS:      ${(b.rms || 0).toFixed(4)}`);
  console.log(`      Bob Heard Signal?   ${b.heard ? "✅ HA (Eshitildi)" : "❌ YO'Q"}`);

  console.log(`\n   User B -> User A (Bob gapirdi, Alice eshitdi):`);
  console.log(`      Alice Bytes Received: ${a.bytesRecv} bytes`);
  console.log(`      Alice Audio RMS:      ${(a.rms || 0).toFixed(4)}`);
  console.log(`      Alice Heard Signal?   ${a.heard ? "✅ HA (Eshitildi)" : "❌ YO'Q"}`);

  const pass = (a.webrtcState === "connected" && b.webrtcState === "connected" && a.heard && b.heard);
  console.log("\n=======================================================");
  console.log(`🏆 FINAL TEST VERDICT: ${pass ? "✅ 100% ISHLADI (IKKALA TOMON HAM OVOZNI ESHITDI VA GAPIRDI!)" : "❌ XATOLIK"}`);
  console.log("=======================================================\n");

  fs.writeFileSync(
    path.resolve(process.cwd(), "tools/real_test_report.json"),
    JSON.stringify({ passed: pass, reports: finalReports }, null, 2)
  );

  console.log("\n👀 Oynalar ekranda OCHIQ QOLDIRILDI!");
  console.log("   Chapda: Alice (User 1)");
  console.log("   O'ngda: Bob (User 2)");
  console.log("   Istalgan vaqtda oynalarni o'zingiz ko'rib, tugmalarni bosib, keyin yopishingiz mumkin.\n");

  await prisma.$disconnect();
}

run().catch(err => {
  console.error("Test execution error:", err);
  process.exit(1);
});
