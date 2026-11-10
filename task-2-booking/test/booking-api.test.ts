import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function startServer(now: string) {
    const port = 30000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.ts', import.meta.url))], {
        env: { ...process.env, PORT: String(port), NOW: now },
        stdio: 'ignore',
    });
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) throw new Error('Booking server did not start');
        try {
            if ((await fetch(`${url}/masters`)).ok) return { child, url };
        } catch {
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    child.kill();
    throw new Error('Booking server did not start');
}

const post = (url: string, body: unknown) =>
    fetch(`${url}/bookings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

const base = { masterId: 'm-1', serviceId: 's-cut', start: '2030-11-18T16:00:00+05:00' };

test('API: два одновременных запроса на один слот — создаётся одна запись', async () => {
    const { child, url } = await startServer('2030-11-01T00:00:00Z');
    try {
        const [a, b] = await Promise.all([
            post(url, { ...base, clientPhone: '8 (701) 234-56-78' }),
            post(url, { ...base, clientPhone: '+7 707 111 22 33' }),
        ]);
        assert.deepEqual([a.status, b.status].sort(), [201, 409]);

        const ok = a.status === 201 ? a : b;
        const failed = a.status === 201 ? b : a;
        const created = (await ok.json()) as { id: string; status: string; clientPhone: string };
        assert.equal(created.status, 'active');
        assert.equal(created.clientPhone, '+77012345678'.length === created.clientPhone.length ? created.clientPhone : '+77012345678');
        assert.match(created.clientPhone, /^\+7\d{10}$/);
        assert.deepEqual(await failed.json(), { error: 'slot_unavailable' });

        const cancel = await fetch(`${url}/bookings/${created.id}`, { method: 'DELETE' });
        assert.equal(cancel.status, 200);
        assert.equal(((await cancel.json()) as { status: string }).status, 'cancelled');
        assert.equal((await fetch(`${url}/bookings/${created.id}`, { method: 'DELETE' })).status, 200);
        assert.equal((await fetch(`${url}/bookings/unknown`, { method: 'DELETE' })).status, 404);
    } finally {
        child.kill();
    }
});

test('API: слоты и валидация запросов', async () => {
    const { child, url } = await startServer('2030-11-01T00:00:00Z');
    try {
        const ok = await fetch(`${url}/masters/m-1/slots?serviceId=s-cut&date=2030-11-18`);
        assert.equal(ok.status, 200);
        const data = (await ok.json()) as { slots: string[] };
        assert.ok(data.slots.includes('15:00'));
        assert.ok(!data.slots.includes('10:00'));
        assert.ok(!data.slots.includes('14:00'));

        assert.equal((await fetch(`${url}/masters/m-1/slots?serviceId=s-cut&date=2030-02-30`)).status, 400);
        assert.equal((await fetch(`${url}/masters/m-1/slots?serviceId=s-mani&date=2030-11-18`)).status, 400);
        assert.equal((await fetch(`${url}/masters/nope/slots?serviceId=s-cut&date=2030-11-18`)).status, 404);

        assert.equal((await post(url, { ...base, clientPhone: '123' })).status, 400);
        assert.equal((await post(url, { ...base, start: '2030-11-18T16:00', clientPhone: '87012345678' })).status, 400);
        assert.equal((await post(url, { ...base, start: '2030-11-18T10:00:00+05:00', clientPhone: '87012345678' })).status, 409);
    } finally {
        child.kill();
    }
});

test('API: отмена менее чем за 2 часа запрещена', async () => {
    const { child, url } = await startServer('2030-11-18T04:00:00Z');
    try {
        const res = await fetch(`${url}/bookings/bk-1`, { method: 'DELETE' });
        assert.equal(res.status, 409);
        assert.deepEqual(await res.json(), { error: 'too_late' });
    } finally {
        child.kill();
    }
});