import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignBranch } from '../src/router.ts';
import { distanceKm } from '../src/geo.ts';
import type { Branch, Order } from '../src/types.ts';

const branch = (over: Partial<Branch>): Branch => ({
  id: 'b-1',
  storeId: 's-1',
  name: 'Филиал',
  city: 'Алматы',
  lat: 43.24,
  lon: 76.91,
  active: true,
  pickupPointIds: [],
  dailyLimit: 100,
  ...over,
});

const order = (over: Partial<Order>): Order => ({
  id: 'o-1',
  storeId: 's-1',
  city: 'Алматы',
  lat: 43.25,
  lon: 76.92,
  pickupPointId: null,
  manualBranchId: null,
  createdAt: '2026-11-16T06:00:00Z',
  ...over,
});

const almaty = branch({ id: 'b-ala', city: 'Алматы', lat: 43.2567, lon: 76.9286 });
const astana = branch({ id: 'b-ast', city: 'Астана', lat: 51.128, lon: 71.43 });

test('distanceKm: Алматы — Астана около 970 км', () => {
  const d = distanceKm(43.2389, 76.8897, 51.1694, 71.4491);
  assert.ok(Math.abs(d - 970) < 15, `получили ${d.toFixed(1)}`);
});

test('manual: заказ уходит в указанный филиал', () => {
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'manual' });
});

test('manual: неактивный филиал пропускается', () => {
  const closed = { ...astana, active: false };
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, closed]);
  assert.notEqual(res.rule, 'manual');
});

test('single: у магазина один активный филиал', () => {
  const res = assignBranch(order({ city: 'Шымкент' }), [almaty]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'single' });
});

test('geo: выбирается ближайший филиал', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: 43.25, lon: 76.93 }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'geo' });
});

test('geo: без координат заказ не распределяется', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: null, lon: null }), [almaty, astana]);
  assert.equal(res.rule, 'unassigned');
});

test('pickup_point: пункт выдачи закреплён за филиалом', () => {
  const pickup = branch({ ...astana, pickupPointIds: ['pp-5'] });
  const res = assignBranch(order({ pickupPointId: 'pp-5' }), [almaty, pickup]);
  assert.equal(res.branchId, 'b-ast');
  assert.equal(res.rule, 'pickup_point');
});

test('city: в городе заказа один филиал магазина', () => {
  const res = assignBranch(order({ city: 'Астана' }), [almaty, astana]);
  assert.equal(res.branchId, 'b-ast');
  assert.equal(res.rule, 'city');
});

test('geo: если в городе несколько филиалов, выбирается ближайший из них', () => {
  const far = branch({ id: 'b-far', city: 'Алматы', lat: 43.4, lon: 76.99 });
  const res = assignBranch(order({ city: 'Алматы', lat: 43.25, lon: 76.92 }), [almaty, far]);
  assert.equal(res.branchId, 'b-ala');
  assert.equal(res.rule, 'geo');
});

test('лимит: заполненный филиал пропускается', () => {
  const busy = branch({ ...almaty, dailyLimit: 1 });
  const free = branch({ ...astana });
  const prevOrder = order({ id: 'prev' });
  const assignments = new Map([
    [prevOrder.id, { orderId: prevOrder.id, branchId: busy.id, rule: 'single' as const }]
  ]);

  // Филиал busy уже забит 1 заказом, поэтому новый заказ должен уйти в free
  const res = assignBranch(order({ id: 'new', city: 'Алматы' }), [busy, free], assignments, [prevOrder]);
  assert.equal(res.branchId, free.id);
  assert.equal(res.rule, 'geo');
});
