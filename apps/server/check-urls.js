const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.message.findMany({
  where: { fileUrl: { not: null } },
  take: 5,
  select: { fileUrl: true, fileName: true, fileMime: true }
}).then(r => {
  console.log(JSON.stringify(r, null, 2));
  p.$disconnect();
});
