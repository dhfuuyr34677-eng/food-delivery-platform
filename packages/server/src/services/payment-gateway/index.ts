// Payment Gateway — factory and convenience functions.
// Follows the exact pattern from services/delivery/index.ts

import type { PaymentGatewayProvider, PaymentProviderConfig } from './types';
import { PaymentProviderType } from '@fd/shared';
import { WechatPayDirectProvider } from './wechat-pay-direct';
import { WechatPayAggregatedProvider } from './wechat-pay-aggregated';
import { MockPaymentProvider } from './mock';
import { db } from '../../db';
import { paymentProviders, orders } from '../../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Factory: create a provider instance from a named config.
 * Must be updated when adding a new provider type.
 */
export function createPaymentGateway(config: PaymentProviderConfig): PaymentGatewayProvider {
  switch (config.type) {
    case PaymentProviderType.WECHAT_PAY_DIRECT:
      return new WechatPayDirectProvider(config);
    case PaymentProviderType.WECHAT_PAY_AGGREGATED:
      return new WechatPayAggregatedProvider(config);
    case PaymentProviderType.MOCK:
      return new MockPaymentProvider(config);
    default:
      throw new Error(`Unknown payment provider type: ${config.type}`);
  }
}

/**
 * Get the payment gateway for a given order.
 * Looks up the default payment provider from the database.
 * Falls back to WeChat Pay Direct (compatibility mode) if no provider configured.
 */
export async function getGatewayForOrder(_order?: {
  id: string;
}): Promise<PaymentGatewayProvider> {
  // Try the default active provider first
  const [defaultProvider] = await db
    .select()
    .from(paymentProviders)
    .where(eq(paymentProviders.isDefault, true))
    .limit(1);

  if (defaultProvider && defaultProvider.isActive) {
    return createPaymentGateway({
      type: defaultProvider.providerType as PaymentProviderConfig['type'],
      name: defaultProvider.name,
      config: defaultProvider.config as Record<string, unknown>,
    });
  }

  // Fallback: WeChat Pay Direct (backward compatible with existing env vars)
  return createPaymentGateway({
    type: PaymentProviderType.WECHAT_PAY_DIRECT,
    name: 'WeChat Pay Direct (fallback)',
    config: {},
  });
}

/**
 * Get a payment gateway by provider ID.
 */
export async function getProviderById(providerId: string): Promise<PaymentGatewayProvider> {
  const [row] = await db
    .select()
    .from(paymentProviders)
    .where(eq(paymentProviders.id, providerId))
    .limit(1);

  if (!row) {
    throw new Error(`Payment provider ${providerId} not found`);
  }

  return createPaymentGateway({
    type: row.providerType as PaymentProviderConfig['type'],
    name: row.name,
    config: row.config as Record<string, unknown>,
  });
}
