import { relations } from 'drizzle-orm';
import {
  users,
  addresses,
  shops,
  shopAdmins,
  categories,
  products,
  orders,
  orderItems,
  orderStatusLogs,
  settlements,
  admins,
  uploads,
  deliveryProviders,
  deliveryOrders,
  deliveryCallbacks,
  paymentProviders,
  splitOrders,
  splitReceivers,
} from './schema';

export const usersRelations = relations(users, ({ many }) => ({
  addresses: many(addresses),
  orders: many(orders),
  uploads: many(uploads),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, { fields: [addresses.userId], references: [users.id] }),
}));

export const shopsRelations = relations(shops, ({ one, many }) => ({
  shopAdmins: many(shopAdmins),
  categories: many(categories),
  products: many(products),
  orders: many(orders),
  settlements: many(settlements),
  deliveryProvider: one(deliveryProviders, {
    fields: [shops.deliveryProviderId],
    references: [deliveryProviders.id],
  }),
}));

export const shopAdminsRelations = relations(shopAdmins, ({ one }) => ({
  shop: one(shops, { fields: [shopAdmins.shopId], references: [shops.id] }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  shop: one(shops, { fields: [categories.shopId], references: [shops.id] }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  shop: one(shops, { fields: [products.shopId], references: [shops.id] }),
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  orderItems: many(orderItems),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  shop: one(shops, { fields: [orders.shopId], references: [shops.id] }),
  items: many(orderItems),
  statusLogs: many(orderStatusLogs),
  deliveryOrder: one(deliveryOrders, {
    fields: [orders.id],
    references: [deliveryOrders.orderId],
  }),
  splitOrder: one(splitOrders, {
    fields: [orders.id],
    references: [splitOrders.orderId],
  }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

export const orderStatusLogsRelations = relations(orderStatusLogs, ({ one }) => ({
  order: one(orders, {
    fields: [orderStatusLogs.orderId],
    references: [orders.id],
  }),
}));

export const settlementsRelations = relations(settlements, ({ one }) => ({
  shop: one(shops, { fields: [settlements.shopId], references: [shops.id] }),
}));

export const uploadsRelations = relations(uploads, ({ one }) => ({
  user: one(users, { fields: [uploads.userId], references: [users.id] }),
}));

export const deliveryProvidersRelations = relations(
  deliveryProviders,
  ({ many }) => ({
    deliveryOrders: many(deliveryOrders),
    shops: many(shops),
  }),
);

export const deliveryOrdersRelations = relations(deliveryOrders, ({ one }) => ({
  order: one(orders, {
    fields: [deliveryOrders.orderId],
    references: [orders.id],
  }),
  provider: one(deliveryProviders, {
    fields: [deliveryOrders.providerId],
    references: [deliveryProviders.id],
  }),
}));

export const deliveryCallbacksRelations = relations(
  deliveryCallbacks,
  ({ one }) => ({
    provider: one(deliveryProviders, {
      fields: [deliveryCallbacks.providerId],
      references: [deliveryProviders.id],
    }),
    order: one(orders, {
      fields: [deliveryCallbacks.orderId],
      references: [orders.id],
    }),
  }),
);

export const paymentProvidersRelations = relations(
  paymentProviders,
  ({ many }) => ({
    splitOrders: many(splitOrders),
  }),
);

export const splitOrdersRelations = relations(splitOrders, ({ one, many }) => ({
  order: one(orders, {
    fields: [splitOrders.orderId],
    references: [orders.id],
  }),
  provider: one(paymentProviders, {
    fields: [splitOrders.providerId],
    references: [paymentProviders.id],
  }),
  receivers: many(splitReceivers),
}));

export const splitReceiversRelations = relations(splitReceivers, ({ one }) => ({
  splitOrder: one(splitOrders, {
    fields: [splitReceivers.splitOrderId],
    references: [splitOrders.id],
  }),
}));
