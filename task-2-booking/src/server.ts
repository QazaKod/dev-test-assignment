import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getSlots } from './slots.ts';
import { bookingRepo, masters, services } from './store.ts';

const port = Number(process.env.PORT ?? 3002);

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
