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
} from './schema';

export const usersRelations = relations(users, ({ many }) => ({
  addresses: many(addresses),
  orders: many(orders),
  uploads: many(uploads),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, { fields: [addresses.userId], references: [users.id] }),
}));

export const shopsRelations = relations(shops, ({ many }) => ({
  shopAdmins: many(shopAdmins),
  categories: many(categories),
  products: many(products),
  orders: many(orders),
  settlements: many(settlements),
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
