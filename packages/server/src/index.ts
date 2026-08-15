import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { auth } from './middleware/auth.js';
import { requireRole } from './middleware/role.js';
import { errorHandler } from './middleware/error.js';
import { setupWebSocket } from './services/websocket.js';

// Modules (to be implemented in Phase 1-4)
import { userRoutes } from './modules/user/index.js';
import { shopRoutes } from './modules/shop/index.js';
import { orderRoutes } from './modules/order/index.js';
import { merchantRoutes } from './modules/merchant/index.js';
import { adminRoutes } from './modules/admin/index.js';
import { uploadRoutes } from './modules/upload/index.js';
import { deliveryRoutes } from './modules/delivery/index.js';
import { paymentRoutes } from './modules/payment/index.js';
import { settlementRoutes } from './modules/settlement/index.js';
import { startDeliverySync } from './cron/delivery-sync.js';
import { startSplitSync } from './services/payment-gateway/split-sync.js';

const app = new Hono();

// Global middleware
app.use('*', cors({ origin: process.env.CORS_ORIGIN ?? '*' }));
app.use('*', logger());

// Error handler
app.onError(errorHandler);

// Health check
app.get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));

// Routes
app.route('/api/user', userRoutes);
app.route('/api/shop', shopRoutes);
app.route('/api/order', orderRoutes);
app.route('/api/merchant', merchantRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/upload', uploadRoutes);
app.route('/api/delivery', deliveryRoutes);
app.route('/api/payment', paymentRoutes);
app.route('/api/settlement', settlementRoutes);

const port = Number(process.env.PORT) || 3000;

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[Server] running on http://localhost:${info.port}`);
});

// WebSocket
setupWebSocket(server);

// Delivery sync cron (poll every 2 minutes)
startDeliverySync(120_000);

// Split sync cron (poll every 5 minutes)
startSplitSync(300_000);

export type { JwtPayload } from './utils/jwt.js';
