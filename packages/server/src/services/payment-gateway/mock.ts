// Mock Payment Provider — returns fake data for development and testing.
// Active when no real payment provider config is provided.

import type {
  PaymentGatewayProvider,
  PaymentProviderConfig,
  CreatePaymentParams,
  CreatePaymentResult,
  QueryPaymentParams,
  QueryPaymentResult,
  CreateRefundParams,
  CreateRefundResult,
  CreateSplitParams,
  CreateSplitResult,
  FinishSplitParams,
  FinishSplitResult,
  RefundSplitParams,
  RefundSplitResult,
  QuerySplitParams,
  QuerySplitResult,
  CallbackParams,
  PaymentCallback,
} from './types';

let _counter = 0;
function nextId(): string {
  return `mock_${Date.now()}_${++_counter}`;
}

export class MockPaymentProvider implements PaymentGatewayProvider {
  constructor(public readonly config: PaymentProviderConfig) {}

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const prepayId = `mock_prepay_${nextId()}`;
    return {
      prepayId,
      jsapiParams: {
        appId: 'MOCK_APPID',
        timeStamp: String(Math.floor(Date.now() / 1000)),
        nonceStr: 'mock_nonce',
        package: `prepay_id=${prepayId}`,
        signType: 'MD5',
        paySign: 'MOCK_PAY_SIGN',
      },
    };
  }

  async queryPayment(params: QueryPaymentParams): Promise<QueryPaymentResult> {
    return {
      tradeState: 'SUCCESS',
      transactionId: `mock_txn_${params.orderNo}`,
      amount: 0,
      paidAt: new Date().toISOString(),
    };
  }

  async createRefund(params: CreateRefundParams): Promise<CreateRefundResult> {
    return {
      refundId: `mock_refund_${nextId()}`,
      status: 'SUCCESS',
    };
  }

  async createSplit(params: CreateSplitParams): Promise<CreateSplitResult> {
    return {
      gatewaySplitNo: `mock_split_${nextId()}`,
      receiverResults: params.receivers.map((r) => ({
        receiverType: r.receiverType,
        gatewaySplitNo: `mock_split_recv_${nextId()}`,
        result: 'PENDING',
      })),
    };
  }

  async finishSplit(params: FinishSplitParams): Promise<FinishSplitResult> {
    return {
      gatewaySplitNo: params.gatewaySplitNo,
      status: 'FINISHED',
    };
  }

  async refundSplit(params: RefundSplitParams): Promise<RefundSplitResult> {
    return {
      gatewaySplitNo: params.gatewaySplitNo,
      receiverResults: params.receivers.map((r) => ({
        receiverType: r.receiverType,
        result: 'SUCCESS',
      })),
    };
  }

  async querySplit(params: QuerySplitParams): Promise<QuerySplitResult> {
    return {
      orderId: params.gatewaySplitNo,
      status: 'FINISHED',
      receivers: [],
    };
  }

  async verifyCallback(params: CallbackParams): Promise<PaymentCallback> {
    const body = params.body;
    return {
      eventType: 'TRANSACTION.SUCCESS',
      transactionId: `mock_txn_${body.out_trade_no ?? Date.now()}`,
      outTradeNo: (body.out_trade_no as string) ?? 'MOCK',
      amount: (body.amount as number) ?? 0,
      successTime: new Date().toISOString(),
    };
  }
}
