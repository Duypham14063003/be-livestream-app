export const ADMIN_PAYMENT_AUDIT_ACTIONS = {
  recorded: "ADMIN_PAYMENT_RECORDED",
  statusUpdated: "ADMIN_PAYMENT_STATUS_UPDATED",
  retry: "ADMIN_PAYMENT_RETRY",
  deleted: "ADMIN_PAYMENT_DELETED",
} as const;

export interface AdminPaymentRecordedAuditPayload {
  adminId: string;
  orderId: string;
  paymentId: string;
  provider: string;
  amount: number;
  paid: boolean;
}

export interface AdminPaymentStatusUpdatedAuditPayload {
  adminId: string;
  paymentId: string;
  previousStatus: string;
  nextStatus: string;
  note: string | null;
}

export interface AdminPaymentRetryAuditPayload {
  adminId: string;
  paymentId: string;
  previousProviderRef: string | null;
}

export interface AdminPaymentDeletedAuditPayload {
  adminId: string;
  paymentId: string;
  amount: number;
  orderId: string;
}
