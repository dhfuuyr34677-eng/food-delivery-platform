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
