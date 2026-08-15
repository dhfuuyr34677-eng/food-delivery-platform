import crypto from 'node:crypto';
import type {
  DeliveryProvider,
  DadaConfig,
  QueryFeeParams,
  QueryFeeResult,
  CreateDeliveryParams,
  CreateDeliveryResult,
  DeliveryStatusResult,
} from './types';
import { mapDadaStatusToDeliveryStatus } from '@fd/shared';

const DADA_PROD_BASE = 'https://newopen.imdada.cn';
const DADA_TEST_BASE = 'http://newopen.qa.imdada.cn';

// ── Helpers ────────────────────────────────────────────

function generateSign(
  appKey: string,
  appSecret: string,
  body: string,
  sourceId: string,
  timestamp: number,
): string {
  const params: Record<string, string> = {
    app_key: appKey,
    body,
    format: 'json',
    source_id: sourceId,
    timestamp: String(timestamp),
    v: '1.0',
  };

  // Sort keys lexicographically
  const sorted = Object.keys(params).sort();
  let signStr = '';
  for (const key of sorted) {
    signStr += key + params[key];
  }

  return crypto
    .createHash('md5')
    .update(appSecret + signStr + appSecret)
    .digest('hex')
    .toUpperCase();
}

function buildRequest(
  config: DadaConfig,
  bodyObj: unknown,
): { url: string; body: string; headers: Record<string, string> } {
  const body = JSON.stringify(bodyObj);
  const timestamp = Math.floor(Date.now() / 1000);

  const signature = generateSign(
    config.appKey,
    config.appSecret,
    body,
    config.sourceId,
    timestamp,
  );

  const requestBody = JSON.stringify({
    app_key: config.appKey,
    body,
    format: 'json',
    source_id: config.sourceId,
    signature,
    timestamp,
    v: '1.0',
  });

  const baseUrl = config.baseUrl ?? DADA_PROD_BASE;

  return {
    url: baseUrl,
    body: requestBody,
    headers: {
      'Content-Type': 'application/json',
    },
  };
}

async function dadaRequest<T>(
  config: DadaConfig,
  path: string,
  bodyObj: unknown,
): Promise<T> {
  const { url, body, headers } = buildRequest(config, bodyObj);
  const timeout = config.timeout ?? 10000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${url}${path}`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Dada API HTTP ${response.status}: ${errText}`);
    }

    const json = (await response.json()) as {
      status: string;
      result?: T;
      msg?: string;
      errorCode?: string;
    };

    if (json.status !== 'success') {
      throw new Error(
        `Dada API error: ${json.errorCode ?? 'UNKNOWN'} — ${json.msg ?? 'no message'}`,
      );
    }

    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

// ── Dada Provider Implementation ──────────────────────

export class DadaProvider implements DeliveryProvider {
  readonly name = 'dada';
  private config: DadaConfig;

  constructor(config: DadaConfig) {
    this.config = config;
  }

  async queryFee(params: QueryFeeParams): Promise<QueryFeeResult> {
    interface DadaFeeResult {
      deliverFee: number; // da da returns in yuan
      distance: number; // meters
    }

    const result = await dadaRequest<DadaFeeResult>(
      this.config,
      '/api/order/queryDeliverFee',
      {
        shop_no: params.externalShopNo,
        origin_id: params.originId,
        city_code: params.cityCode,
        cargo_price: params.cargoPrice,
        is_prepay: params.isPrepay,
        receiver_name: params.receiverName,
        receiver_address: params.receiverAddress,
        receiver_lat: params.receiverLat,
        receiver_lng: params.receiverLng,
        receiver_phone: params.receiverPhone,
        cargo_weight: params.cargoWeight,
        cargo_type: params.cargoType,
        callback: params.callback,
      },
    );

    // Dada returns fee in yuan, convert to fen
    const deliveryFee = Math.round((result.deliverFee ?? result.deliverFee) * 100);

    return {
      deliveryFee,
      distance: result.distance,
      raw: result,
    };
  }

  async createOrder(
    params: CreateDeliveryParams,
  ): Promise<CreateDeliveryResult> {
    interface DadaAddOrderResult {
      order_id?: string;
      client_id?: string;
      distance: number;
      deliverFee: number;
    }

    const body: Record<string, unknown> = {
      shop_no: params.externalShopNo,
      origin_id: params.originId,
      city_code: params.cityCode,
      cargo_price: params.cargoPrice,
      is_prepay: params.isPrepay,
      receiver_name: params.receiverName,
      receiver_address: params.receiverAddress,
      receiver_lat: params.receiverLat,
      receiver_lng: params.receiverLng,
      receiver_phone: params.receiverPhone,
      cargo_weight: params.cargoWeight,
      cargo_type: params.cargoType,
      callback: params.callback,
    };

    if (params.tip) {
      body.tip = params.tip;
    }

    const result = await dadaRequest<DadaAddOrderResult>(
      this.config,
      '/api/order/addOrder',
      body,
    );

    const externalOrderId = result.order_id ?? result.client_id ?? '';
    const deliveryFee = Math.round((result.deliverFee ?? 0) * 100);

    return {
      externalOrderId,
      deliveryFee,
      distance: result.distance,
      raw: result,
    };
  }

  async cancelOrder(
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    await dadaRequest(this.config, '/api/order/formalCancel', {
      order_id: externalOrderId,
      cancel_reason_id: 1, // 默认取消原因
      cancel_reason: reason ?? 'Platform order cancelled',
    });
  }

  async queryStatus(
    externalOrderId: string,
  ): Promise<DeliveryStatusResult> {
    interface DadaStatusResult {
      orderId: string;
      statusCode: number;
      transporterName?: string;
      transporterPhone?: string;
      transporterLng?: number;
      transporterLat?: number;
      deliveryFinishTime?: string;
      createTime?: string;
      expectFetchTime?: string;
    }

    const result = await dadaRequest<DadaStatusResult>(
      this.config,
      '/api/order/status/query',
      { order_id: externalOrderId },
    );

    const deliveryStatus = mapDadaStatusToDeliveryStatus(result.statusCode);

    return {
      externalOrderId: result.orderId,
      statusCode: result.statusCode,
      deliveryStatus,
      riderName: result.transporterName,
      riderPhone: result.transporterPhone,
      riderLat: result.transporterLat,
      riderLng: result.transporterLng,
      estimatedDeliveryTime: result.expectFetchTime,
      actualDeliveryTime: result.deliveryFinishTime,
      raw: result,
    };
  }

  verifyCallback(payload: Record<string, unknown>): boolean {
    // Dada callback signature:
    // signature = MD5(client_id + order_id + update_time) sorted lexicographically
    const { signature, client_id, order_id, update_time } = payload;

    if (!signature || !client_id || !order_id || !update_time) {
      return false;
    }

    const parts = [
      String(client_id),
      String(order_id),
      String(update_time),
    ].sort();

    const expectedSign = crypto
      .createHash('md5')
      .update(parts.join(''))
      .digest('hex');

    return expectedSign === String(signature);
  }

  /** Expose for testing */
  static generateSign(
    appKey: string,
    appSecret: string,
    body: string,
    sourceId: string,
    timestamp: number,
  ): string {
    return generateSign(appKey, appSecret, body, sourceId, timestamp);
  }
}
