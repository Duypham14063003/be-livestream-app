-- AlterEnum
ALTER TYPE "public"."RefundStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "public"."Refund" ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- CreateIndex
CREATE INDEX "Refund_status_createdAt_idx" ON "public"."Refund"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Refund" ADD CONSTRAINT "Refund_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
