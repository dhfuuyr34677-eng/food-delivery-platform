// Calculate distance between two points in meters (Haversine formula)
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Format distance for display
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

// Format money (fen to yuan)
export function formatMoney(fen: number): string {
  return (fen / 100).toFixed(2);
}

// Calculate total amount from order items
export function calcOrderAmount(
  items: Array<{ price?: number; unitPrice?: number; quantity: number }>,
  deliveryFee: number = 0,
): number {
  const subtotal = items.reduce(
    (sum, item) => sum + (item.price ?? item.unitPrice ?? 0) * item.quantity,
    0,
  );
  return subtotal + deliveryFee;
}

// Generate order number
export function generateOrderNo(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const M = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `FD${y}${M}${d}${h}${m}${s}${rand}`;
}
