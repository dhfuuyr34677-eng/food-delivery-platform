// Payment Gateway abstraction — follows the same pattern as services/delivery/types.ts
// All amounts are in fen (分). All status strings drawn from shared SplitStatus.

import type { PaymentProviderTypeValue } from '@fd/shared';

// ── Provider Config ──────────────────────────────────

export interface PaymentProviderConfig {
  type: PaymentProviderTypeValue;
  name: string;
  config: Record<string, unknown>;
}

// ── Create Payment ───────────────────────────────────

export interface CreatePaymentParams {
  orderId: string;
  orderNo: string;
  amount: number;
  description: string;
  payerOpenid: string;
  attach?: string;
  notifyUrl: string;
}

export interface CreatePaymentResult {
  prepayId: string;
  jsapiParams: Record<string, string>;
}

// ── Query Payment ────────────────────────────────────

export interface QueryPaymentParams {
  orderNo: string;
  transactionId?: string;
}

export interface QueryPaymentResult {
  tradeState: string;
  transactionId?: string;
  amount?: number;
  paidAt?: string;
}

// ── Refund ───────────────────────────────────────────

export interface CreateRefundParams {
  orderNo: string;
  transactionId: string;
  totalAmount: number;
  refundAmount: number;
  refundReason?: string;
  outRefundNo: string;
}

export interface CreateRefundResult {
  refundId: string;
  status: string;
}

// ── Split (Profit Sharing) ───────────────────────────

export interface SplitReceiver {
  receiverType: 'merchant' | 'platform' | 'delivery';
  receiverId: string;
  receiverName: string;
  amount: number;
  description: string;
}

export interface CreateSplitParams {
  orderId: string;
  transactionId: string;
  totalAmount: number;
  receivers: SplitReceiver[];
  idempotencyKey: string;
}

export interface CreateSplitResult {
  gatewaySplitNo: string;
  receiverResults: Array<{
    receiverType: string;
    gatewaySplitNo?: string;
    result: string;
  }>;
}

export interface FinishSplitParams {
  gatewaySplitNo: string;
  transactionId: string;
  totalAmount: number;
  idempotencyKey: string;
}

export interface FinishSplitResult {
  gatewaySplitNo: string;
  status: string;
}

export interface RefundSplitParams {
  gatewaySplitNo: string;
  transactionId: string;
  totalAmount: number;
  receivers: SplitReceiver[];
  idempotencyKey: string;
}

export interface RefundSplitResult {
  gatewaySplitNo: string;
  receiverResults: Array<{
    receiverType: string;
    result: string;
  }>;
}

export interface QuerySplitParams {
  gatewaySplitNo: string;
  transactionId: string;
}

export interface QuerySplitResult {
  orderId: string;
  status: string;
  receivers: Array<{
    receiverType: string;
    amount: number;
    result: string;
  }>;
}

// ── Callback ─────────────────────────────────────────

export interface CallbackParams {
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface PaymentCallback {
  eventType: string;
  transactionId: string;
  outTradeNo: string;
  amount: number;
  payerOpenid?: string;
  successTime?: string;
}

// ── Abstract Interface ───────────────────────────────

export interface PaymentGatewayProvider {
  readonly config: PaymentProviderConfig;

  // Payment lifecycle
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  queryPayment(params: QueryPaymentParams): Promise<QueryPaymentResult>;
  createRefund(params: CreateRefundParams): Promise<CreateRefundResult>;

  // Split (profit sharing) lifecycle
  createSplit(params: CreateSplitParams): Promise<CreateSplitResult>;
  finishSplit(params: FinishSplitParams): Promise<FinishSplitResult>;
  refundSplit(params: RefundSplitParams): Promise<RefundSplitResult>;
  querySplit(params: QuerySplitParams): Promise<QuerySplitResult>;

  // Callback verification
  verifyCallback(params: CallbackParams): Promise<PaymentCallback>;
}
