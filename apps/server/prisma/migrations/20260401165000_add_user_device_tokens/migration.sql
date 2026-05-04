-- Create table for mobile push tokens
CREATE TABLE "UserDeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDeviceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserDeviceToken_token_key" ON "UserDeviceToken"("token");
CREATE INDEX "UserDeviceToken_userId_idx" ON "UserDeviceToken"("userId");

ALTER TABLE "UserDeviceToken"
ADD CONSTRAINT "UserDeviceToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
