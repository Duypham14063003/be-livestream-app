-- AlterTable
ALTER TABLE "public"."LiveRoom" ADD COLUMN     "title" TEXT,
ALTER COLUMN "eventId" DROP NOT NULL;
