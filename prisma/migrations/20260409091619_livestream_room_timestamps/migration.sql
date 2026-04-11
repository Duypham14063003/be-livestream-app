-- AlterTable
ALTER TABLE "public"."LiveRoom" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LiveRoom_status_startedAt_idx" ON "public"."LiveRoom"("status", "startedAt");
