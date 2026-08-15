// Order status enum
export const OrderStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  DELIVERING: 'delivering',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type OrderStatusType = (typeof OrderStatus)[keyof typeof OrderStatus];

// Statuses in which user can cancel
export const USER_CANCELLABLE_STATUSES: OrderStatusType[] = [
  OrderStatus.PENDING,
  OrderStatus.PREPARING,
];

// Allowed transitions: from -> [to]
export const ALLOWED_TRANSITIONS: Record<OrderStatusType, OrderStatusType[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.DELIVERING, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERING]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

export function canTransition(
  from: OrderStatusType,
  to: OrderStatusType,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// User role enum
export const UserRole = {
  USER: 'user',
  MERCHANT: 'merchant',
  ADMIN: 'admin',
} as const;

export type UserRoleType = (typeof UserRole)[keyof typeof UserRole];

// Shop status
export const ShopStatus = {
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const;

export type ShopStatusType = (typeof ShopStatus)[keyof typeof ShopStatus];

// Settlement status
export const SettlementStatus = {
  PENDING: 'pending',
  SETTLED: 'settled',
  PAID: 'paid',
} as const;

export type SettlementStatusType =
  (typeof SettlementStatus)[keyof typeof SettlementStatus];

// Payment status
export const PaymentStatus = {
  UNPAID: 'unpaid',
  PAID: 'paid',
  REFUNDING: 'refunding',
  REFUNDED: 'refunded',
} as const;

export type PaymentStatusType =
  (typeof PaymentStatus)[keyof typeof PaymentStatus];

// Delivery type
export const DeliveryType = {
  SELF: 'self',
  PLATFORM: 'platform',
} as const;

export type DeliveryTypeType =
  (typeof DeliveryType)[keyof typeof DeliveryType];

// Delivery order status
export const DeliveryOrderStatus = {
  PENDING: 'pending',
  CREATED: 'created',
  ASSIGNED: 'assigned',
  PICKED_UP: 'picked_up',
  DELIVERING: 'delivering',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  ABNORMAL: 'abnormal',
} as const;

export type DeliveryOrderStatusType =
  (typeof DeliveryOrderStatus)[keyof typeof DeliveryOrderStatus];

// Delivery status transitions
export const DELIVERY_TRANSITIONS: Record<
  DeliveryOrderStatusType,
  DeliveryOrderStatusType[]
> = {
  [DeliveryOrderStatus.PENDING]: [
    DeliveryOrderStatus.CREATED,
    DeliveryOrderStatus.CANCELLED,
  ],
  [DeliveryOrderStatus.CREATED]: [
    DeliveryOrderStatus.ASSIGNED,
    DeliveryOrderStatus.CANCELLED,
  ],
  [DeliveryOrderStatus.ASSIGNED]: [
    DeliveryOrderStatus.PICKED_UP,
    DeliveryOrderStatus.CANCELLED,
  ],
  [DeliveryOrderStatus.PICKED_UP]: [DeliveryOrderStatus.DELIVERING],
  [DeliveryOrderStatus.DELIVERING]: [
    DeliveryOrderStatus.DELIVERED,
    DeliveryOrderStatus.ABNORMAL,
  ],
  [DeliveryOrderStatus.DELIVERED]: [],
  [DeliveryOrderStatus.CANCELLED]: [],
  [DeliveryOrderStatus.ABNORMAL]: [],
};

export function canTransitionDelivery(
  from: DeliveryOrderStatusType,
  to: DeliveryOrderStatusType,
): boolean {
  return DELIVERY_TRANSITIONS[from]?.includes(to) ?? false;
}

// Delivery status is terminal (no further changes)
export function isDeliveryTerminal(status: DeliveryOrderStatusType): boolean {
  return (
    status === DeliveryOrderStatus.DELIVERED ||
    status === DeliveryOrderStatus.CANCELLED ||
    status === DeliveryOrderStatus.ABNORMAL
  );
}

// ── Payment Provider Type ─────────────────────────

export const PaymentProviderType = {
  WECHAT_PAY_DIRECT: 'wechat_pay_direct',
  WECHAT_PAY_AGGREGATED: 'wechat_pay_aggregated',
  MOCK: 'mock',
} as const;

export type PaymentProviderTypeValue =
  (typeof PaymentProviderType)[keyof typeof PaymentProviderType];

// ── Split (Profit Sharing) Status ──────────────────

export const SplitStatus = {
  UNSPLIT: 'unsplit',
  PROCESSING: 'processing',
  FINISHED: 'finished',
  RETURNING: 'returning',
  RETURNED: 'returned',
  FAILED: 'failed',
  CLOSED: 'closed',
} as const;

export type SplitStatusType =
  (typeof SplitStatus)[keyof typeof SplitStatus];

// ── Split Receiver Type ────────────────────────────

export const SplitReceiverType = {
  MERCHANT: 'merchant',
  PLATFORM: 'platform',
  DELIVERY: 'delivery',
} as const;

export type SplitReceiverTypeValue =
  (typeof SplitReceiverType)[keyof typeof SplitReceiverType];

// Map Dada callback status codes to our delivery status
// Dada: 1=待接单, 2=待取货, 3=配送中, 4=已送达, 5=已取消, 9/10=异常
export function mapDadaStatusToDeliveryStatus(
  dadaStatus: number,
): DeliveryOrderStatusType {
  switch (dadaStatus) {
    case 1:
      return DeliveryOrderStatus.CREATED;
    case 2:
      return DeliveryOrderStatus.ASSIGNED;
    case 3:
      return DeliveryOrderStatus.DELIVERING;
    case 4:
      return DeliveryOrderStatus.DELIVERED;
    case 5:
      return DeliveryOrderStatus.CANCELLED;
    case 9:
    case 10:
      return DeliveryOrderStatus.ABNORMAL;
    default:
      return DeliveryOrderStatus.PENDING;
  }
}
