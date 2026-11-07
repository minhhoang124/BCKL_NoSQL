import { Injectable } from '@nestjs/common';
import { VNPay, HashAlgorithm, type ReturnQueryFromVNPay } from 'vnpay';
import { vnpayConfig } from './vnpay-config.js';
import { vnpayAmount, vnpayDate } from './vnpay-input.js';
@Injectable()
export class VnpayGateway {
  private sdk() {
    const c = vnpayConfig(false);
    return new VNPay({
      tmnCode: c.tmnCode,
      secureSecret: c.secret,
      testMode: true,
      hashAlgorithm: HashAlgorithm.SHA512,
      enableLog: false,
    });
  }
  build(row: {
    reference: string;
    amount: { toFixed: (digits: number) => string };
    createdAt: Date;
    expiresAt: Date;
    ipAddress: string;
    returnUrl: string;
    tmnCode: string;
  }) {
    const c = vnpayConfig(false);
    if (c.tmnCode !== row.tmnCode || c.returnUrl !== row.returnUrl)
      throw new Error('VNPAY_CONFIG_CHANGED');
    return this.sdk().buildPaymentUrl({
      vnp_Amount: vnpayAmount(row.amount.toFixed(2)).vnd,
      vnp_IpAddr: row.ipAddress,
      vnp_ReturnUrl: row.returnUrl,
      vnp_TxnRef: row.reference,
      vnp_OrderInfo: 'BCKL sandbox ' + row.reference,
      vnp_CreateDate: Number(vnpayDate(row.createdAt)),
      vnp_ExpireDate: Number(vnpayDate(row.expiresAt)),
    });
  }
  verified(q: Record<string, string>) {
    try {
      return (
        this.sdk().verifyIpnCall(q as unknown as ReturnQueryFromVNPay)
          .isVerified === true
      );
    } catch {
      return false;
    }
  }
}
