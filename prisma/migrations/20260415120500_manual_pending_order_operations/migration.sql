-- CreateEnum
CREATE TYPE "public"."ReservationSource" AS ENUM ('CHECKOUT', 'ADMIN_MANUAL_ORDER');

-- AlterTable
ALTER TABLE "public"."Reservation"
ADD COLUMN "source" "public"."ReservationSource" NOT NULL DEFAULT 'CHECKOUT';

-- AlterTable
ALTER TABLE "public"."Order"
ADD COLUMN "adminNote" TEXT;

-- CreateTable
CREATE TABLE "public"."SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
