import type { Booking, Master, Service } from './types.ts';
import { fromMinutes, overlaps, toMinutes, TZ_OFFSET, weekday } from './time.ts';
import { now } from './clock.ts';


export const SLOT_STEP_MIN = 15;

const toMs = (date: String, hhmm: String) => new Date(`${date}T${hhmm}:00${TZ_OFFSET}`).getTime();

// Свободные слоты мастера на дату, 'HH:mm' по Алматы
export function getSlots(master: Master, service: Service, date: string, bookings: Booking[]): string[] {
  const day = master.schedule[weekday(date)];
  if (!day) return [];

  const current = now().getTime();
  const breaks = day.breaks.map((b) => ({
    start: toMs(date, b.from),
    end: toMs(date, b.to),
  }))

  const activeBookings = bookings
    .filter((b) => b.masterId === master.id && b.status === 'active')
    .map((b) => ({
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }));

  const result: string[] = [];
  const endOfDay = toMinutes(day.to);
  for (let t = toMinutes(day.from); t + service.durationMin <= endOfDay; t += SLOT_STEP_MIN) {
    const start = toMs(date, fromMinutes(t));
    if (start <= current) continue;
    const slot = { start, end: start + service.durationMin * 60_000 };
    if (breaks.some((b) => overlaps(slot, b))) continue;
    if (activeBookings.some((b) => overlaps(slot, b))) continue;
    result.push(fromMinutes(t));
  }
  return result;
}
