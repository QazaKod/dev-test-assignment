import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Assignment, Branch, Order } from './types.ts';

const dataDir = process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data');

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as T;
}

export const branches: Branch[] = load('branches.json');
export const orders: Order[] = load('orders.json');

// orderId -> распределение

export const assignments = new Map<string, Assignment>();
