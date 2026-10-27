import { describe, expect, test } from 'bun:test';
import { backoffMs } from './http';
import { events, fixture, json, setup } from './test-helpers';

const req = { messages: [] };
const ok = () => json(fixture('message-text'));
const fail = (status: number, headers: Record<string, string> = {}) =>
	json(fixture('error-overloaded'), { status, headers });

describe('retries', () => {
	test('429 waits the retry-after, then succeeds', async () => {
		const t = setup([fail(429, { 'retry-after': '3' }), ok()]);
		const out = await events(t.model, req);
		expect(t.calls).toHaveLength(2);
		expect(t.sleeps).toEqual([3000]);
		expect(out.at(-1)).toEqual({ type: 'finish', reason: 'end' });
	});

	test('529 and 500 back off exponentially without retry-after (jitter 1)', async () => {
		const t = setup([fail(529), fail(500), ok()]);
		await events(t.model, req);
		expect(t.sleeps).toEqual([500, 1000]);
	});

	test('an HTTP-date retry-after is read against the injected clock', async () => {
		const t = setup([
			fail(429, { 'retry-after': 'Thu, 01 Jan 2026 00:00:07 GMT' }),
			ok(),
		]);
		await events(t.model, req);
		expect(t.sleeps).toEqual([7000]);
	});

	test('stops after maxRetries and throws the last error', async () => {
		const t = setup([fail(529)], { maxRetries: 2 });
		const error = await events(t.model, req).catch((e) => e);
		expect(t.calls).toHaveLength(3);
		expect(error).toMatchObject({ kind: 'overloaded', status: 529 });
	});

	test('maxRetries 0 never retries', async () => {
		const t = setup([fail(429)], { maxRetries: 0 });
		await events(t.model, req).catch(() => {});
		expect(t.calls).toHaveLength(1);
		expect(t.sleeps).toEqual([]);
	});

	test('no retry on 400, 401, 403, 413', async () => {
		for (const status of [400, 401, 403, 413]) {
			const t = setup([fail(status), ok()]);
			await events(t.model, req).catch(() => {});
			expect(t.calls).toHaveLength(1);
		}
	});

	test('a retry-after beyond a minute is reported, not waited', async () => {
		const t = setup([fail(429, { 'retry-after': '120' }), ok()]);
		const error = await events(t.model, req).catch((e) => e);
		expect(error).toMatchObject({
			kind: 'rate-limited',
			retryAfterMs: 120_000,
		});
		expect(t.sleeps).toEqual([]);
	});

	test('network failures are retried, then reported as network', async () => {
		const t = setup([new TypeError('fetch failed'), ok()]);
		expect((await events(t.model, req)).at(-1)).toEqual({
			type: 'finish',
			reason: 'end',
		});
		const t2 = setup([new TypeError('fetch failed')], { maxRetries: 1 });
		const error = await events(t2.model, req).catch((e) => e);
		expect(error).toMatchObject({ kind: 'network', code: 'MODEL_ERROR' });
		expect(t2.calls).toHaveLength(2);
	});

	test('backoff caps at 8 s and jitters between half and full', () => {
		expect(backoffMs(0, 0)).toBe(250);
		expect(backoffMs(10, 1)).toBe(8000);
		expect(backoffMs(10, 0)).toBe(4000);
	});
});

describe('abort', () => {
	test('aborting during the wait ends the stream without an error', async () => {
		const ac = new AbortController();
		const t = setup([fail(429), ok()], {
			sleep: async (_ms, signal) => {
				ac.abort();
				if (signal.aborted) throw signal.reason;
			},
		});
		expect(await events(t.model, req, ac.signal)).toEqual([]);
		expect(t.calls).toHaveLength(1);
	});

	test('an already aborted signal sends nothing', async () => {
		const t = setup([ok()]);
		expect(await events(t.model, req, AbortSignal.abort())).toEqual([]);
		expect(t.calls).toHaveLength(0);
	});

	test('the signal reaches fetch; an abort mid-request ends quietly', async () => {
		const ac = new AbortController();
		const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
			ac.abort();
			throw init?.signal?.reason;
		}) as unknown as typeof fetch;
		const t = setup([ok()], { fetch: fetchImpl });
		expect(await events(t.model, req, ac.signal)).toEqual([]);
	});
});
