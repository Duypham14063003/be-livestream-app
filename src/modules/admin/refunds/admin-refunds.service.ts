import { Injectable } from "@nestjs/common";
import { PaymentsService } from "../../payments/payments.service";

@Injectable()
export class AdminRefundsService {
  constructor(private readonly paymentsService: PaymentsService) {}

  approveRefund(refundId: string, adminUserId: string, decisionNote?: string) {
    return this.paymentsService.approveRefund(
      refundId,
      adminUserId,
      decisionNote,
    );
  }

  rejectRefund(refundId: string, adminUserId: string, decisionNote: string) {
    return this.paymentsService.rejectRefund(
      refundId,
      adminUserId,
      decisionNote,
    );
  }
}
