-- Migration: add_livestream_comments_gifts

-- Step 1: Add commentsEnabled column to LiveRoom
ALTER TABLE "LiveRoom" ADD COLUMN "commentsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Step 2: Create LiveGiftType enum
CREATE TYPE "LiveGiftType" AS ENUM ('HEART', 'ROSE', 'STAR', 'ROCKET', 'CROWN', 'DIAMOND');

-- Step 3: Create LiveComment table
CREATE TABLE "LiveComment" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "isHost" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiveComment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LiveComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LiveComment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 4: Create LiveGift table
CREATE TABLE "LiveGift" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "giftType" "LiveGiftType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiveGift_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LiveGift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LiveGift_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 5: Add relations to User model (via foreign key constraints already above)
-- LiveComment & LiveGift already have user relation
-- Add reverse relations to User model (handled by Prisma, no migration needed for existing columns)

-- Step 6: Create indexes
CREATE INDEX "LiveComment_roomId_createdAt_idx" ON "LiveComment"("roomId", "createdAt");
CREATE INDEX "LiveComment_userId_idx" ON "LiveComment"("userId");
CREATE INDEX "LiveGift_roomId_createdAt_idx" ON "LiveGift"("roomId", "createdAt");
CREATE INDEX "LiveGift_userId_idx" ON "LiveGift"("userId");