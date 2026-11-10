import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getSlots } from './slots.ts';
import { bookingRepo, masters, services } from './store.ts';
import { randomUUID } from 'node:crypto';
import type { Booking } from './types.ts';
import { now } from './clock.ts';

const port = Number(process.env.PORT ?? 3002);

const ala_offset_ms = 5 * 60 * 60_000;
const TWO_HOURS_MS = 2 * 60 * 60_000;

function parseStart(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\+?[\d\s()-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length !== 11) return null;
  if (trimmed.startsWith('+') ? digits[0] !== '7' : digits[0] !== '7' && digits[0] !== '8') return null;
  const national = digits.slice(1);
  if (national[0] !== '7') return null;
  return `+7${national}`;
}

const locks = new Map<string, Promise<unknown>>();

async function withMasterLock<T>(masterId: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(masterId) ?? Promise.resolve();
  const run = previous.then(action, action);
  const tail = run.catch(() => undefined);
  locks.set(masterId, tail);
  try {
    return await run;
  } finally {
    if (locks.get(masterId) === tail) locks.delete(masterId);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  function isValidDate(value: string | null): value is string {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/masters') {
      return send(res, 200, masters);
    }

    if (req.method === 'GET' && url.pathname === '/services') {
      return send(res, 200, services);
    }

    if (req.method === 'GET' && parts[0] === 'masters' && parts[2] === 'slots' && parts.length === 3) {
      const master = masters.find((m) => m.id === parts[1]);
      if (!master) return send(res, 404, { error: 'master_not_found' });

      const serviceId = url.searchParams.get('serviceId');
      const date = url.searchParams.get('date');
      if (!serviceId || !isValidDate(date)) {
        return send(res, 400, { error: 'invalid_request' });
      }
      const service = services.find((s) => s.id === serviceId);
      if (!service) return send(res, 404, { error: 'service_not_found' });
      if (!service.masterIds.includes(master.id)) {
        return send(res, 400, { error: 'service_unavailable' });
      }
      const bookings = await bookingRepo.listByMaster(master.id);
      const slots = getSlots(master, service, date, bookings);
      return send(res, 200, { masterId: master.id, serviceId: service.id, date, slots });
    }

    if (req.method === 'POST' && url.pathname === '/bookings') {
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return send(res, 400, { error: 'invalid_json' });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return send(res, 400, { error: 'invalid_request' });
      }
      const input = body as Record<string, unknown>;
      if (typeof input.masterId !== 'string' || typeof input.serviceId !== 'string') {
        return send(res, 400, { error: 'invalid_request' });
      }

      const master = masters.find((m) => m.id === input.masterId);
      if (!master) return send(res, 404, { error: 'master_not_found' });
      const service = services.find((s) => s.id === input.serviceId);
      if (!service) return send(res, 404, { error: 'service_not_found' });

      const start = parseStart(input.start);
      const clientPhone = normalizePhone(input.clientPhone);
      if (!start || !clientPhone || !service.masterIds.includes(master.id)) {
        return send(res, 400, { error: 'invalid_request' });
      }

      const created = await withMasterLock(master.id, async () => {
        if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) return null;
        const local = new Date(start.getTime() + ala_offset_ms).toISOString();
        const bookings = await bookingRepo.listByMaster(master.id);
        if (!getSlots(master, service, local.slice(0, 10), bookings).includes(local.slice(11, 16))) {
          return null;
        }
        const booking: Booking = {
          id: `bk-${randomUUID()}`,
          masterId: master.id,
          serviceId: service.id,
          start: start.toISOString(),
          end: new Date(start.getTime() + service.durationMin * 60_000).toISOString(),
          clientPhone,
          status: 'active',
        };
        await bookingRepo.insert(booking);
        return booking;
      });

      if (!created) return send(res, 409, { error: 'slot_unavailable' });
      return send(res, 201, created);
    }

    if (req.method === 'DELETE' && parts[0] === 'bookings' && parts.length === 2) {
      const result = await withMasterLock(`booking:${parts[1]}`, async () => {
        const booking = await bookingRepo.get(parts[1]);
        if (!booking) return { status: 404, body: { error: 'booking_not_found' } };
        if (booking.status === 'cancelled') return { status: 200, body: booking };

        if (new Date(booking.start).getTime() - now().getTime() < TWO_HOURS_MS) {
          return { status: 409, body: { error: 'too_late' } };
        }

        await bookingRepo.update(booking.id, { status: 'cancelled' });
        return { status: 200, body: { ...booking, status: 'cancelled' } };
      });
      return send(res, result.status, result.body);
    }

    send(res, 404, { error: 'not_found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'internal' });
  }
});

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

server.listen(port, () => {
  console.log(`booking: http://localhost:${port}`);
});
