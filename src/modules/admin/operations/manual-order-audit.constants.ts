export const ADMIN_ORDER_AUDIT_ACTIONS = {
  create: "ADMIN_MANUAL_ORDER_CREATED",
  replaceSeats: "ADMIN_MANUAL_ORDER_SEATS_REPLACED",
  cancel: "ADMIN_ORDER_CANCELLED",
  delete: "ADMIN_MANUAL_ORDER_DELETED",
  updateTtl: "ADMIN_MANUAL_PENDING_TTL_UPDATED",
} as const;

export interface AdminManualOrderCreatedAuditPayload {
  adminId: string;
  userId: string;
  eventId: string;
  reservationId: string;
  seatIds: string[];
  expiresAt: string;
  adminNote: string | null;
}

export interface AdminManualOrderSeatsReplacedAuditPayload {
  adminId: string;
  reservationId: string;
  previousSeatIds: string[];
  nextSeatIds: string[];
  addedSeatIds: string[];
  removedSeatIds: string[];
}

export interface AdminOrderCancelledAuditPayload {
  adminId: string;
  reservationId: string;
  reason: string | null;
  mode: "release_hold" | "refund_request_only";
  refundId: string | null;
}

export interface AdminManualOrderDeletedAuditPayload {
  adminId: string;
  reservationId: string;
  seatIds: string[];
}

export interface AdminManualPendingTtlUpdatedAuditPayload {
  adminId: string;
  previousTtlMinutes: number;
  nextTtlMinutes: number;
}
