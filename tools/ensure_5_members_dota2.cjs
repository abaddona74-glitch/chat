require('dotenv').config({ path: '/opt/chat/apps/server/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const group = await prisma.group.findFirst({
    where: { name: 'dota 2' },
    include: { members: true }
  });
  if (!group) {
    console.error('Group "dota 2" not found');
    return;
  }

  const allUsers = await prisma.user.findMany({
    take: 5,
    select: { id: true, displayName: true, email: true }
  });

  console.log(`Ensuring ${allUsers.length} users are in group "dota 2"...`);
  for (const u of allUsers) {
    const isMember = group.members.some(m => m.userId === u.id);
    if (!isMember) {
      await prisma.groupMember.create({
        data: {
          groupId: group.id,
          userId: u.id,
          role: 'MEMBER'
        }
      });
      console.log(`Added ${u.displayName} (${u.email}) to "dota 2"`);
    } else {
      console.log(`Already member: ${u.displayName} (${u.email})`);
    }
  }

  const updated = await prisma.group.findUnique({
    where: { id: group.id },
    include: { members: { include: { user: { select: { id: true, displayName: true, email: true } } } } }
  });

  console.log('=== 5 MEMBERS IN DOTA 2 ===');
  console.log(JSON.stringify(updated.members.map(m => m.user), null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
