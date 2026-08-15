import { db } from '../../db';
import {
  deliveryProviders,
  shops,
} from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { DadaProvider } from './dada';
import type { DeliveryProvider, DadaConfig } from './types';

export type { DeliveryProvider, DadaConfig } from './types';
export { DadaProvider } from './dada';

/** Provider factory — create instance by name */
export function createProvider(name: string, config: unknown): DeliveryProvider {
  switch (name) {
    case 'dada':
      return new DadaProvider(config as DadaConfig);
    default:
      throw new Error(`Unknown delivery provider: ${name}`);
  }
}

/** Get the active provider for a shop */
export async function getProviderForShop(
  shopId: string,
): Promise<{ provider: DeliveryProvider; externalShopNo: string } | null> {
  const [shop] = await db
    .select({
      deliveryProviderId: shops.deliveryProviderId,
      externalShopNo: shops.externalShopNo,
    })
    .from(shops)
    .where(eq(shops.id, shopId));

  if (!shop?.deliveryProviderId || !shop?.externalShopNo) return null;

  const [provider] = await db
    .select()
    .from(deliveryProviders)
    .where(
      and(
        eq(deliveryProviders.id, shop.deliveryProviderId),
        eq(deliveryProviders.isActive, true),
      ),
    );

  if (!provider) return null;

  return {
    provider: createProvider(provider.name, provider.config),
    externalShopNo: shop.externalShopNo,
  };
}

/** Get provider by ID */
export async function getProviderById(
  providerId: string,
): Promise<DeliveryProvider | null> {
  const [row] = await db
    .select()
    .from(deliveryProviders)
    .where(
      and(
        eq(deliveryProviders.id, providerId),
        eq(deliveryProviders.isActive, true),
      ),
    );

  if (!row) return null;
  return createProvider(row.name, row.config);
}
