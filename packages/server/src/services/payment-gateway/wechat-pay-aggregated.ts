// WeChat Pay Aggregated Provider — communicates with an aggregation platform
// (e.g. 汇付天下/收钱吧/通联支付) that has pre-established merchant sub-merchant
// relationships for automatic profit sharing (分账).
//
// TODO: Replace the stub implementations with real API calls once the
// aggregation service provider is selected and credentials are obtained.

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

export class WechatPayAggregatedProvider implements PaymentGatewayProvider {
  private baseUrl: string;
  private appId: string;
  private mchId: string;

  constructor(public readonly config: PaymentProviderConfig) {
    const c = config.config as Record<string, string>;
    this.baseUrl = c.baseUrl ?? 'https://api.example-aggregator.com';
    this.appId = c.appId ?? '';
    this.mchId = c.mchId ?? '';
  }

  // ── Payment ──────────────────────────────────────

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    // TODO: Call aggregation gateway's payment endpoint
    // POST {baseUrl}/v1/pay/transactions/jsapi
    // Body: { out_trade_no, description, amount: { total, currency }, payer: { openid }, notify_url }
    throw new Error('WechatPayAggregatedProvider.createPayment not implemented. Configure the aggregation gateway.');
  }

  async queryPayment(params: QueryPaymentParams): Promise<QueryPaymentResult> {
    // TODO: GET {baseUrl}/v1/pay/transactions/out-trade-no/{outTradeNo}?mchId={mchId}
    throw new Error('WechatPayAggregatedProvider.queryPayment not implemented.');
  }

  async createRefund(params: CreateRefundParams): Promise<CreateRefundResult> {
    // TODO: POST {baseUrl}/v1/pay/refunds
    throw new Error('WechatPayAggregatedProvider.createRefund not implemented.');
  }

  // ── Split (Profit Sharing) ───────────────────────

  async createSplit(params: CreateSplitParams): Promise<CreateSplitResult> {
    // TODO: POST {baseUrl}/v1/profitsharing/orders
    // Body: { transaction_id, out_order_no, receivers: [{ type, account, amount, description }], unfreeze_unsplit: false }
    throw new Error('WechatPayAggregatedProvider.createSplit not implemented.');
  }

  async finishSplit(params: FinishSplitParams): Promise<FinishSplitResult> {
    // TODO: POST {baseUrl}/v1/profitsharing/orders/unfreeze
    throw new Error('WechatPayAggregatedProvider.finishSplit not implemented.');
  }

  async refundSplit(params: RefundSplitParams): Promise<RefundSplitResult> {
    // TODO: POST {baseUrl}/v1/profitsharing/return-orders
    throw new Error('WechatPayAggregatedProvider.refundSplit not implemented.');
  }

  async querySplit(params: QuerySplitParams): Promise<QuerySplitResult> {
    // TODO: GET {baseUrl}/v1/profitsharing/orders/{gatewaySplitNo}?transaction_id={transactionId}
    throw new Error('WechatPayAggregatedProvider.querySplit not implemented.');
  }

  // ── Callback ─────────────────────────────────────

  async verifyCallback(params: CallbackParams): Promise<PaymentCallback> {
    // TODO: Verify aggregation gateway callback signature, then parse body
    throw new Error('WechatPayAggregatedProvider.verifyCallback not implemented.');
  }
}
