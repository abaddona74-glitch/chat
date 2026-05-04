-- Add third-stage delivery status timestamp:
-- seenAt = sender has seen that recipient read the message.
ALTER TABLE "Message"
ADD COLUMN "seenAt" TIMESTAMP(3);

CREATE INDEX "Message_senderId_recipientId_seenAt_idx"
ON "Message"("senderId", "recipientId", "seenAt");
