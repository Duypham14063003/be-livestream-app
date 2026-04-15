/*
  Warnings:

  - A unique constraint covering the columns `[eventId]` on the table `LiveRoom` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."LiveRoom" ADD COLUMN     "eventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LiveRoom_eventId_key" ON "public"."LiveRoom"("eventId");

-- AddForeignKey
ALTER TABLE "public"."LiveRoom" ADD CONSTRAINT "LiveRoom_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
