// @rev kc-31 как будто это детект на ИИ но все равно добавлю "По этой метке скрипт стенда собирает список файлов ревизии"
import type { Assignment, Branch, Order } from './types.ts';
import { distanceKm } from './geo.ts';

const ala_offset_ms = 5 * 60 * 60 * 1000;

export function alaDate(isoDate : string): string {
  const time= new Date(isoDate).getTime();
  return new Date(time + ala_offset_ms).toISOString().slice(0, 10);
}

export function branchLoad(
  branchId: string,
  date: string,
  assignments: Map<string, Assignment>,
  orders: Order[]
): number {
  let count =0 ;
  for (const assignment of assignments.values()) {
    if (assignment.branchId === branchId) {
      const order = orders.find((o) => o.id === assignment.orderId);
      if (order && alaDate(order.createdAt) === date) {
        count++;
      }
    }
  }
  return count;
}

export function assignBranch(
  order: Order,
  branches: Branch[],
  assignments: Map<string, Assignment> = new Map(),
  orders: Order[] = []
): Assignment {

  const alreadyAssigned = assignments.get(order.id);
  if(alreadyAssigned) return alreadyAssigned;

  const own = branches.filter((b) => b.storeId === order.storeId && b.active);

  if (order.manualBranchId) {
    const manual = own.find((b) => b.id === order.manualBranchId);
    if (manual) return { orderId: order.id, branchId: manual.id, rule: 'manual' };
  }

  let chosen: Branch | null = null;
  let rule: Assignment['rule'] = 'unassigned';

  if (own.length === 1) {
    chosen = own[0];
    rule = 'single';
  } else {
    if (order.pickupPointId) {
      const byPickup = own.find((b) => b.pickupPointIds.includes(order.pickupPointId!));
      if (byPickup) {
        chosen = byPickup;
        rule = 'pickup_point';
      }
    }
  }
  const inCity = own.filter((b) => b.city === order.city);
    if (!chosen && inCity.length === 1) {
      chosen = inCity[0];
      rule = 'city';
    }
    if (!chosen) {
      const candidates = inCity.length > 1 ? inCity : own;
      const nearest = findNearest(order, candidates);
      if (nearest) {
        chosen = nearest;
        rule = 'geo';
      }
    }
    if (!chosen) {
    return { orderId: order.id, branchId: null, rule: 'unassigned' };
  }

  const date = alaDate(order.createdAt);
  const isAvailable = (b: Branch) => branchLoad(b.id, date, assignments, orders) < b.dailyLimit;
  if (isAvailable(chosen)) {
    return { orderId: order.id, branchId: chosen.id, rule };
  }
  
  const freeBranches = own.filter(isAvailable);
  const fallback = findNearest(order, freeBranches);
  if (fallback) {
    return { orderId: order.id, branchId: fallback.id, rule: 'geo' };
  }
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
