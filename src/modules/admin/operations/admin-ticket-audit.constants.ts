export const ADMIN_TICKET_AUDIT_ACTIONS = {
  issued: "ADMIN_TICKET_ISSUED",
  statusUpdated: "ADMIN_TICKET_STATUS_UPDATED",
  voided: "ADMIN_TICKET_VOIDED",
  resendAttempted: "ADMIN_TICKET_RESEND_ATTEMPTED",
  deleted: "ADMIN_TICKET_DELETED",
} as const;

export interface AdminTicketIssuedAuditPayload {
  adminId: string;
  orderId: string;
  userId: string;
  seatId: string;
  eventId: string;
}

export interface AdminTicketStatusUpdatedAuditPayload {
  adminId: string;
  ticketId: string;
  previousStatus: string;
  nextStatus: string;
}

export interface AdminTicketVoidedAuditPayload {
  adminId: string;
  ticketId: string;
  seatReleased: boolean;
  reason: string | null;
}

export interface AdminTicketResendAttemptedAuditPayload {
  adminId: string;
  ticketId: string;
}

export interface AdminTicketDeletedAuditPayload {
  adminId: string;
  ticketId: string;
  seatId: string;
  orderId: string;
}
