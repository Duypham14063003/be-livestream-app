-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('USER', 'ADMIN', 'HOST', 'MODERATOR');

-- CreateEnum
CREATE TYPE "public"."VenueType" AS ENUM ('ONLINE', 'OFFLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "public"."SeatStatus" AS ENUM ('AVAILABLE', 'HELD', 'BOOKED', 'CHECKED_IN');

-- CreateEnum
CREATE TYPE "public"."ReservationStatus" AS ENUM ('HELD', 'CONFIRMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('PENDING', 'PAID', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PaymentProvider" AS ENUM ('STRIPE', 'PAYPAL', 'APPLE_PAY', 'GOOGLE_PAY');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "public"."TicketStatus" AS ENUM ('ACTIVE', 'USED', 'REFUNDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."LiveRoomStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "public"."LiveParticipantRole" AS ENUM ('HOST', 'CO_HOST', 'AUDIENCE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "public"."RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" "public"."UserRole" NOT NULL DEFAULT 'USER',
    "kycStatus" TEXT,
    "trustedDevice" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Event" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "venueType" "public"."VenueType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Seat" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "row" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "public"."SeatStatus" NOT NULL DEFAULT 'AVAILABLE',
    "price" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Reservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "public"."ReservationStatus" NOT NULL DEFAULT 'HELD',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReservationSeat" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "public"."OrderStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "public"."PaymentProvider" NOT NULL,
    "providerRef" TEXT,
    "status" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Ticket" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "status" "public"."TicketStatus" NOT NULL DEFAULT 'ACTIVE',
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LiveRoom" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "agoraChannel" TEXT NOT NULL,
    "status" "public"."LiveRoomStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LiveParticipant" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."LiveParticipantRole" NOT NULL DEFAULT 'AUDIENCE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "LiveParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LiveOverlay" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveOverlay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LiveTimelineEvent" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveTimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "public"."RefundStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "public"."User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_eventId_zone_row_number_key" ON "public"."Seat"("eventId", "zone", "row", "number");

-- CreateIndex
CREATE INDEX "Reservation_eventId_status_idx" ON "public"."Reservation"("eventId", "status");

-- CreateIndex
CREATE INDEX "Reservation_userId_status_idx" ON "public"."Reservation"("userId", "status");

-- CreateIndex
CREATE INDEX "ReservationSeat_seatId_idx" ON "public"."ReservationSeat"("seatId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationSeat_reservationId_seatId_key" ON "public"."ReservationSeat"("reservationId", "seatId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_reservationId_key" ON "public"."Order"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_key" ON "public"."Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "public"."Payment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_seatId_key" ON "public"."Ticket"("seatId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_qrCode_key" ON "public"."Ticket"("qrCode");

-- CreateIndex
CREATE UNIQUE INDEX "LiveRoom_eventId_key" ON "public"."LiveRoom"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveRoom_agoraChannel_key" ON "public"."LiveRoom"("agoraChannel");

-- CreateIndex
CREATE UNIQUE INDEX "LiveParticipant_roomId_userId_key" ON "public"."LiveParticipant"("roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "public"."Refund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "public"."AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "public"."Seat" ADD CONSTRAINT "Seat_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reservation" ADD CONSTRAINT "Reservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reservation" ADD CONSTRAINT "Reservation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReservationSeat" ADD CONSTRAINT "ReservationSeat_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "public"."Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReservationSeat" ADD CONSTRAINT "ReservationSeat_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "public"."Seat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "public"."Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Ticket" ADD CONSTRAINT "Ticket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Ticket" ADD CONSTRAINT "Ticket_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "public"."Seat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LiveRoom" ADD CONSTRAINT "LiveRoom_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LiveParticipant" ADD CONSTRAINT "LiveParticipant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "public"."LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LiveParticipant" ADD CONSTRAINT "LiveParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LiveOverlay" ADD CONSTRAINT "LiveOverlay_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "public"."LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LiveTimelineEvent" ADD CONSTRAINT "LiveTimelineEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "public"."LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LiveTimelineEvent" ADD CONSTRAINT "LiveTimelineEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
