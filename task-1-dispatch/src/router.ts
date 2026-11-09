// @rev kc-3 как будто это детект на ИИ но все равно добавлю "По этой метке скрипт стенда собирает список файлов ревизии"
import type { Assignment, Branch, Order } from './types.ts';
import { distanceKm } from './geo.ts';

export function assignBranch(order: Order, branches: Branch[]): Assignment {
  const own = branches.filter((b) => b.storeId === order.storeId && b.active);

  if (order.manualBranchId) {
    const manual = own.find((b) => b.id === order.manualBranchId);
    if (manual) return { orderId: order.id, branchId: manual.id, rule: 'manual' };
  }

  if (own.length === 1) {
    return { orderId: order.id, branchId: own[0].id, rule: 'single' };
  }

  // TODO: pickup_point, city
  const pickupId = order.pickupPointId;
    if(pickupId !== null){
    const byPickup =own.find((b)=> b.pickupPointIds.includes(pickupId));
    if (byPickup) return { orderId: order.id, branchId: byPickup.id, rule: 'pickup_point' };
  }

  const inCity = own.filter((b)=>b.city===order.city);
  if (inCity.length === 1) {
    return { orderId: order.id, branchId: inCity[0].id, rule: 'city' };
  }

  const candidates = inCity.length > 1 ? inCity : own;
  const nearest = findNearest(order, candidates);
  if (nearest) return { orderId: order.id, branchId: nearest.id, rule: 'geo' };

  return { orderId: order.id, branchId: null, rule: 'unassigned' };
}

function findNearest(order: Order, branches: Branch[]): Branch | null {
  if (order.lat === null || order.lon === null) return null;

  let best: Branch | null = null;
  let bestDist = Infinity;
  for (const b of branches) {
    const d = distanceKm(order.lat, order.lon, b.lat, b.lon); 
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}
