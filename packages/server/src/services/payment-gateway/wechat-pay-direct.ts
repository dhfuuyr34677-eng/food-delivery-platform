// WeChat Pay Direct wrapper — delegates to the existing wechat-pay.ts service.
// Split methods throw 'Not supported' — direct WeChat Pay lacks merchant sub-account
// relationships needed for 分账. Use an aggregated provider for split payments.

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
import {
  createJSAPIPrepay,
  buildJSAPIParams,
  verifyAndDecryptCallback,
  createRefund as wxCreateRefund,
  queryOrder,
} from '../wechat-pay';

export class WechatPayDirectProvider implements PaymentGatewayProvider {
  constructor(public readonly config: PaymentProviderConfig) {}

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const { prepay_id } = await createJSAPIPrepay({
      orderNo: params.orderNo,
      openid: params.payerOpenid,
      totalAmount: params.amount,
      description: params.description,
    });
    const jsapiParams = buildJSAPIParams(prepay_id);
    return { prepayId: prepay_id, jsapiParams: { ...jsapiParams } };
  }

  async queryPayment(params: QueryPaymentParams): Promise<QueryPaymentResult> {
    const result = await queryOrder(params.orderNo);
    return {
      tradeState: result.trade_state,
      transactionId: result.transaction_id,
    };
  }

  async createRefund(params: CreateRefundParams): Promise<CreateRefundResult> {
    const result = await wxCreateRefund({
      outTradeNo: params.orderNo,
      transactionId: params.transactionId,
      totalAmount: params.totalAmount,
      refundAmount: params.refundAmount,
    });
    return { refundId: result.refund_id, status: result.status };
  }

  async createSplit(_params: CreateSplitParams): Promise<CreateSplitResult> {
    throw new Error(
      'WeChat Pay Direct does not support profit sharing (分账). ' +
      'Use an aggregated payment provider (wechat_pay_aggregated).',
    );
  }

  async finishSplit(_params: FinishSplitParams): Promise<FinishSplitResult> {
    throw new Error('Profit sharing not supported on direct WeChat Pay.');
  }

  async refundSplit(_params: RefundSplitParams): Promise<RefundSplitResult> {
    throw new Error('Profit sharing not supported on direct WeChat Pay.');
  }

  async querySplit(_params: QuerySplitParams): Promise<QuerySplitResult> {
    throw new Error('Profit sharing not supported on direct WeChat Pay.');
  }

  async verifyCallback(params: CallbackParams): Promise<PaymentCallback> {
    // Build headers in the format expected by the existing wechat-pay.ts
    const headers = {
      'wechatpay-timestamp': params.headers['wechatpay-timestamp'] ?? '',
      'wechatpay-nonce': params.headers['wechatpay-nonce'] ?? '',
      'wechatpay-signature': params.headers['wechatpay-signature'] ?? '',
      'wechatpay-serial': params.headers['wechatpay-serial'] ?? '',
    };
    const body = JSON.stringify(params.body);
    const result = await verifyAndDecryptCallback(headers, body);

    return {
      eventType: 'TRANSACTION.SUCCESS',
      transactionId: result.transaction_id ?? '',
      outTradeNo: result.out_trade_no,
      amount: result.amount?.total ?? 0,
      successTime: undefined,
    };
  }
}
