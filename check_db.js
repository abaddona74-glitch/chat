const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.message.findMany({
  orderBy: { createdAt: "desc" },
  take: 10,
  select: { id: true, senderId: true, recipientId: true, text: true, readAt: true, createdAt: true }
}).then(m => {
  console.log(JSON.stringify(m, null, 2));
  p.$disconnect();
}).catch(e => { console.error(e); p.$disconnect(); });
