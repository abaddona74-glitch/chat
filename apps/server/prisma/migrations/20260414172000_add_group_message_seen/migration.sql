CREATE TABLE "GroupMessageSeen" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GroupMessageSeen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupMessageSeen_messageId_userId_key" ON "GroupMessageSeen"("messageId", "userId");
CREATE INDEX "GroupMessageSeen_userId_seenAt_idx" ON "GroupMessageSeen"("userId", "seenAt");

ALTER TABLE "GroupMessageSeen"
ADD CONSTRAINT "GroupMessageSeen_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "GroupMessage"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupMessageSeen"
ADD CONSTRAINT "GroupMessageSeen_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
