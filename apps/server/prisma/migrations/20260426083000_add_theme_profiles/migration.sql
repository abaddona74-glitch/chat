-- CreateTable
CREATE TABLE "ThemeProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accentColor" TEXT NOT NULL,
    "layoutColor" TEXT NOT NULL,
    "textColor" TEXT NOT NULL,
    "backgroundColor" TEXT NOT NULL,
    "inputColor" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThemeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ThemeProfile_isPublic_createdAt_idx" ON "ThemeProfile"("isPublic", "createdAt");

-- CreateIndex
CREATE INDEX "ThemeProfile_authorId_createdAt_idx" ON "ThemeProfile"("authorId", "createdAt");

-- AddForeignKey
ALTER TABLE "ThemeProfile" ADD CONSTRAINT "ThemeProfile_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
