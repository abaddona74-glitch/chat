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
  console.log("🛠️ Preparing 3 test accounts in database...");
  const dummyPasswordHash = "$2a$10$abcdefghijklmnopqrstuvwxyzABCDEF"; // dummy bcrypt hash

  const userConfigs = [
    { email: "test_alice@groupcall.test", displayName: "Alice Test", username: "alice_test" },
    { email: "test_bob@groupcall.test", displayName: "Bob Test", username: "bob_test" },
    { email: "test_charlie@groupcall.test", displayName: "Charlie Test", username: "charlie_test" }
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

  // Sort alphabetically by ID to know deterministic order
  users.sort((a, b) => a.id.localeCompare(b.id));
  console.log("✅ Users ready (ordered by ID):");
  users.forEach((u, i) => console.log(`   User ${String.fromCharCode(65 + i)}: ${u.name} (id: ${u.id})`));

  // Find or create test group
  let group = await prisma.group.findFirst({
    where: { name: "WebRTC 3-Party Audio Test Group" },
    include: { members: true }
  });

  if (!group) {
    group = await prisma.group.create({
      data: {
        name: "WebRTC 3-Party Audio Test Group",
        createdById: users[0].id,
        members: {
          create: [
            { userId: users[0].id, role: "OWNER" },
            { userId: users[1].id, role: "MEMBER" },
            { userId: users[2].id, role: "MEMBER" }
          ]
        }
      },
      include: { members: true }
    });
  } else {
    // Ensure all 3 members exist
    for (const u of users) {
      const isMember = group.members.some(m => m.userId === u.id);
      if (!isMember) {
        await prisma.groupMember.create({
          data: { groupId: group.id, userId: u.id, role: "MEMBER" }
        });
      }
    }
  }

  console.log(`✅ Test Group ready: "${group.name}" (id: ${group.id})\n`);
  return { users, groupId: group.id };
}

async function run() {
  const { users, groupId } = await prepareUsersAndGroup();

  const testData = {
    groupId,
    userA: users[0],
    userB: users[1],
    userC: users[2]
  };

  const htmlContent = fs.readFileSync(path.resolve(process.cwd(), "tools/group_call_test.html"), "utf8");

  let testResultPromiseResolve;
  const testResultPromise = new Promise((res) => { testResultPromiseResolve = res; });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/" || url.pathname === "/test") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlContent);
    } else if (url.pathname === "/api/test-results" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const results = JSON.parse(body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          testResultPromiseResolve(results);
        } catch (e) {
          res.writeHead(400).end();
        }
      });
    } else {
      res.writeHead(404).end("Not found");
    }
  });

  const TEST_PORT = 8899;
  await new Promise(r => server.listen(TEST_PORT, r));
  console.log(`🌐 Test server listening on http://localhost:${TEST_PORT}`);

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const targetUrl = `http://localhost:${TEST_PORT}/test?data=${encodeURIComponent(JSON.stringify(testData))}`;

  console.log("🚀 Launching Headless Chrome to execute WebRTC mesh group call test...");

  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--allow-file-access-from-files",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-web-security",
    "--no-sandbox",
    "--disable-gpu",
    targetUrl
  ]);

  chromeProc.on("error", (err) => {
    console.error("Failed to launch Chrome:", err);
  });

  const timeoutTimer = setTimeout(() => {
    testResultPromiseResolve({ error: "Test timed out after 35 seconds", passed: false });
  }, 35000);

  const results = await testResultPromise;
  clearTimeout(timeoutTimer);

  chromeProc.kill();
  server.close();
  await prisma.$disconnect();

  console.log("\n=======================================================");
  console.log("📊 3-PARTY GROUP CALL TEST DETAILED REPORT");
  console.log("=======================================================");

  if (results.error) {
    console.error("❌ TEST FAILED WITH ERROR:", results.error);
    process.exit(1);
  }

  console.log("\n1️⃣  WebRTC Mesh Connection Matrix:");
  console.table(results.connectionMatrix);

  console.log("\n2️⃣  Audio Transmission & Reception Test (Fake Audio Tones):");
  for (const phase of results.audioTestPhases || []) {
    console.log(`\n🎙️  Speaker: ${phase.speaker} (Bytes Sent: ${phase.speakerBytesSent})`);
    if (phase.listenerA) {
      console.log(`   👂 ${phase.listenerA.user}: RMS Vol = ${phase.listenerA.rms}, Peak Freq = ${phase.listenerA.peakFreq} Hz, Bytes Recv = ${phase.listenerA.bytesReceived}, Heard = ${phase.listenerA.hasSignal ? "✅ YES" : "❌ NO"}`);
    }
    if (phase.listenerB) {
      console.log(`   👂 ${phase.listenerB.user}: RMS Vol = ${phase.listenerB.rms}, Peak Freq = ${phase.listenerB.peakFreq} Hz, Bytes Recv = ${phase.listenerB.bytesReceived}, Heard = ${phase.listenerB.hasSignal ? "✅ YES" : "❌ NO"}`);
    }
    if (phase.listenerC) {
      console.log(`   👂 ${phase.listenerC.user}: RMS Vol = ${phase.listenerC.rms}, Peak Freq = ${phase.listenerC.peakFreq} Hz, Bytes Recv = ${phase.listenerC.bytesReceived}, Heard = ${phase.listenerC.hasSignal ? "✅ YES" : "❌ NO"}`);
    }
    console.log(`   Result: ${phase.pass ? "✅ PASS" : "❌ FAIL"}`);
  }

  console.log(`\n3️⃣  Speaking Indicator Broadcast: ${results.speakingTest ? "✅ PASS" : "❌ FAIL"}`);

  console.log("\n=======================================================");
  console.log(`🏆 OVERALL FINAL RESULT: ${results.passed ? "✅ 100% PASSED (ALL 3 USERS CONNECTED & HEARD EACH OTHER)" : "❌ FAILED"}`);
  console.log("=======================================================\n");

  fs.writeFileSync(
    path.resolve(process.cwd(), "tools/test_results.json"),
    JSON.stringify(results, null, 2)
  );

  if (!results.passed) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error("Execution error:", err);
  process.exit(1);
});
