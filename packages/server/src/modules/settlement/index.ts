import { Hono } from 'hono';

export const settlementRoutes = new Hono();

// Placeholder — Phase 4
settlementRoutes.get('/', (c) => c.json({ module: 'settlement' }));
