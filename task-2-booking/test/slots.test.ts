import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSlots } from '../src/slots.ts';
import { overlaps, toMinutes } from '../src/time.ts';
import type { Booking, Master, Service } from '../src/types.ts';

const day = { from: '10:00', to: '13:00', breaks: [] };

const master: Master = {
  id: 'm-1',
  name: 'Тест',
  schedule: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: null, sun: null },
};

const cut: Service = { id: 's-cut', name: 'Стрижка', durationMin: 60, masterIds: ['m-1'] };

const range = (from: string, to: string) => ({ start: toMinutes(from), end: toMinutes(to) });

test('overlaps: пересекающиеся интервалы', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('10:30', '11:30')), true);
});

test('overlaps: запись сразу после другой не пересекается', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('11:00', '12:00')), false);
});

test('getSlots: свободный день', () => {
  // 2030-11-18 — понедельник
  const slots = getSlots(master, cut, '2030-11-18', []);
  assert.deepEqual(slots, ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '12:00']);
});

test('getSlots: выходной', () => {
  assert.deepEqual(getSlots(master, cut, '2030-11-23', []), []);
});

test('getSlots: слот не пересекает перерыв', () => {
  const withBreak: Master = {
    ...master,
    schedule: { ...master.schedule, mon: { ...day, breaks: [{ from: '11:00', to: '11:30' }] } },
  };
  // Стрижка 60 мин: 10:00 успевает до 11:00, а 10:15–11:15 уже наезжают на перерыв
  assert.deepEqual(getSlots(withBreak, cut, '2030-11-18', []), ['10:00', '11:30', '11:45', '12:00']);
});

test('getSlots: занятое время не выдаётся, отменённые записи не мешают', () => {
  const active: Booking = {
    id: 'bk-1',
    masterId: 'm-1',
    serviceId: 's-cut',
    start: '2030-11-18T05:00:00.000Z', // это 10:00 по Алматы
    end: '2030-11-18T06:00:00.000Z',   // это 11:00 по Алматы
    clientPhone: '+77012345678',
    status: 'active',
  };
  assert.deepEqual(getSlots(master, cut, '2030-11-18', [active]), ['11:00', '11:15', '11:30', '11:45', '12:00']);
  assert.equal(getSlots(master, cut, '2030-11-18', [{ ...active, status: 'cancelled' }]).length, 9);
});

test('getSlots: прошедшее время не выдаётся', () => {
  const before = process.env.NOW;
  process.env.NOW = '2030-11-18T06:00:00.000Z'; // сейчас 11:00 по Алматы
  try {
    // 11:00 уже наступило, поэтому выдаёт только начиная с 11:15
    assert.deepEqual(getSlots(master, cut, '2030-11-18', []), ['11:15', '11:30', '11:45', '12:00']);
  } finally {
    if (before === undefined) delete process.env.NOW;
    else process.env.NOW = before;
  }
});
