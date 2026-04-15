-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedAt" TIMESTAMP(3);
