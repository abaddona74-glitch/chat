import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const rows = await p.message.findMany({
  where: { fileUrl: { not: null } },
  take: 5,
  select: { fileUrl: true, fileName: true, fileMime: true }
});
console.log(JSON.stringify(rows, null, 2));
await p.$disconnect();
