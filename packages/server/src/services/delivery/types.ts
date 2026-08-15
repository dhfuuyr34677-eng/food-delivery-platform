// ── Delivery Provider abstract interface ─────────────

export interface QueryFeeParams {
  /** External shop number (e.g., Dada shop_no) */
  externalShopNo: string;
  /** Platform order ID (used as origin_id for idempotency) */
  originId: string;
  /** City code (e.g., '021' for Shanghai) */
  cityCode: string;
  /** Order cargo price in yuan */
  cargoPrice: number;
  /** Whether rider needs to prepay */
  isPrepay: number;
  /** Receiver name */
  receiverName: string;
  /** Receiver address text */
  receiverAddress: string;
  /** Receiver latitude (GCJ-02) */
  receiverLat: number;
  /** Receiver longitude (GCJ-02) */
  receiverLng: number;
  /** Receiver phone */
  receiverPhone: string;
  /** Cargo weight in kg */
  cargoWeight: number;
  /** Cargo type code */
  cargoType: number;
  /** Callback URL for status updates */
  callback: string;
}

export interface QueryFeeResult {
  /** Delivery fee in fen (分) */
  deliveryFee: number;
  /** Estimated delivery distance in meters */
  distance: number;
  /** Raw response for debugging */
  raw?: unknown;
}

export interface CreateDeliveryParams {
  /** External shop number */
  externalShopNo: string;
  /** Platform order ID (used as origin_id) */
  originId: string;
  /** City code */
  cityCode: string;
  /** Order cargo price in yuan */
  cargoPrice: number;
  /** Whether rider needs to prepay */
  isPrepay: number;
  /** Receiver name */
  receiverName: string;
  /** Receiver address text */
  receiverAddress: string;
  /** Receiver latitude (GCJ-02) */
  receiverLat: number;
  /** Receiver longitude (GCJ-02) */
  receiverLng: number;
  /** Receiver phone */
  receiverPhone: string;
  /** Cargo weight in kg */
  cargoWeight: number;
  /** Cargo type code */
  cargoType: number;
  /** Callback URL */
  callback: string;
  /** Tip amount in yuan (optional) */
  tip?: number;
}

export interface CreateDeliveryResult {
  /** External delivery order ID from the provider */
  externalOrderId: string;
  /** Delivery fee in fen */
  deliveryFee: number;
  /** Estimated delivery distance in meters */
  distance: number;
  /** Raw response */
  raw?: unknown;
}

export interface DeliveryStatusResult {
  /** External order ID */
  externalOrderId: string;
  /** Provider-specific status code */
  statusCode: number;
  /** Mapped platform status */
  deliveryStatus: string;
  /** Rider name (if assigned) */
  riderName?: string;
  /** Rider phone (if assigned) */
  riderPhone?: string;
  /** Rider latitude */
  riderLat?: number;
  /** Rider longitude */
  riderLng?: number;
  /** Estimated delivery time */
  estimatedDeliveryTime?: string;
  /** Actual delivery time */
  actualDeliveryTime?: string;
  /** Raw response */
  raw?: unknown;
}

export interface DeliveryProvider {
  /** Unique provider identifier */
  readonly name: string;

  /** Query estimated delivery fee before placing order */
  queryFee(params: QueryFeeParams): Promise<QueryFeeResult>;

  /** Create a delivery order (dispatch to rider) */
  createOrder(params: CreateDeliveryParams): Promise<CreateDeliveryResult>;

  /** Cancel an existing delivery order */
  cancelOrder(externalOrderId: string, reason?: string): Promise<void>;

  /** Query delivery order status (fallback polling) */
  queryStatus(externalOrderId: string): Promise<DeliveryStatusResult>;

  /** Verify callback signature from the provider */
  verifyCallback(payload: Record<string, unknown>): boolean;
}

/** Configuration stored in delivery_providers.config JSONB */
export interface DadaConfig {
  appKey: string;
  appSecret: string;
  sourceId: string;
  /** API base URL. Defaults to production if not set */
  baseUrl?: string;
  /** Timeout in milliseconds, default 10000 */
  timeout?: number;
}
