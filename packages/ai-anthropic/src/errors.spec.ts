import { describe, expect, test } from 'bun:test';
import { AiError } from '@nxgt/ai-core';
import { AnthropicError, parseRetryAfter } from './errors';
import { events, fixture, json, setup } from './test-helpers';

const req = { messages: [] };
const body = fixture('error-overloaded');

const table = [
	[400, 'bad-request', 'MODEL_ERROR', false],
	[401, 'auth', 'AUTHENTICATION', false],
	[403, 'auth', 'AUTHENTICATION', false],
	[404, 'bad-request', 'MODEL_ERROR', false],
	[413, 'bad-request', 'MODEL_ERROR', false],
	[429, 'rate-limited', 'RATE_LIMITED', true],
	[500, 'provider', 'MODEL_ERROR', true],
	[503, 'provider', 'MODEL_ERROR', true],
	[529, 'overloaded', 'MODEL_ERROR', true],
] as const;

describe('error mapping', () => {
	for (const [status, kind, code, retryable] of table) {
		test(`${status} is ${kind} / ${code}`, async () => {
			const t = setup(
				[json(body, { status, headers: { 'request-id': 'req_1' } })],
				{
					maxRetries: 0,
				},
			);
			const error = await events(t.model, req).catch((e) => e);
			expect(error).toBeInstanceOf(AiError);
			expect(error).toBeInstanceOf(AnthropicError);
			expect(error).toMatchObject({
				kind,
				code,
				status,
				retryable,
				requestId: 'req_1',
			});
			expect(error.message).toContain('Overloaded');
		});
	}

	test('a non-JSON error body is kept as text', async () => {
		const t = setup([new Response('bad gateway', { status: 502 })], {
			maxRetries: 0,
		});
		const error = await events(t.model, req).catch((e) => e);
		expect(error.message).toBe('Anthropic API 502: bad gateway');
	});

	test('a 200 that is not JSON is a provider error', async () => {
		const t = setup([new Response('<html>')]);
		const error = await events(t.model, req).catch((e) => e);
		expect(error).toMatchObject({ kind: 'provider', code: 'MODEL_ERROR' });
	});
});

describe('parseRetryAfter', () => {
	const now = Date.parse('2026-01-01T00:00:00Z');
	test('seconds, fractions, dates and junk', () => {
		expect(parseRetryAfter('3', now)).toBe(3000);
		expect(parseRetryAfter('0.5', now)).toBe(500);
		expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:07 GMT', now)).toBe(7000);
		expect(parseRetryAfter('Wed, 31 Dec 2025 00:00:00 GMT', now)).toBe(0);
		expect(parseRetryAfter('soon', now)).toBeUndefined();
		expect(parseRetryAfter(null, now)).toBeUndefined();
	});
});
