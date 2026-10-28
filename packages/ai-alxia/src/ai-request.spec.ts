import { describe, expect, test } from 'bun:test';
import { alxia, responds } from '@alxia/core';
import { language } from '@alxia/language';
import { type AgentObserver, runAgent } from '@nxgt/ai-core';
import { fakeModel } from '@nxgt/ai-testing';
import { agentEvents } from './agent-events';
import { aiRequest } from './ai-request';
import { agentEventStream } from './events';

const messages = [
	{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }] },
];

function build(
	observers: AgentObserver[] = [],
	model = fakeModel([{ text: 'Bonjour' }]),
) {
	return alxia()
		.use(language({ supported: ['en', 'fr'] as const, fallback: 'en' }))
		.use(aiRequest({ observers }))
		.get('/lang', ({ ai, reply }) => reply(200, ai.language))
		.get('/chat', responds({ 200: agentEventStream }), ({ ai, reply }) =>
			reply(200, agentEvents(runAgent({ model, messages, ...ai }), ai)),
		);
}

describe('aiRequest', () => {
	test('puts the request language on ctx.ai', async () => {
		const app = build();
		expect(await (await app.request('/lang?lang=fr')).text()).toContain('fr');
		expect(await (await app.request('/lang')).text()).toContain('en');
	});

	test('hands the observers to the run', async () => {
		const ended: string[] = [];
		const app = build([{ onRunEnd: (r) => void ended.push(r.reason) }]);
		await (await app.request('/chat')).text();
		expect(ended).toEqual(['end']);
	});

	test('the signal aborts when the client disconnects', async () => {
		let seen: AbortSignal | undefined;
		const app = alxia()
			.use(language({ supported: ['en'] as const, fallback: 'en' }))
			.use(aiRequest())
			.get('/s', ({ ai, reply }) => {
				seen = ai.signal;
				return reply(200, 'ok');
			});
		const controller = new AbortController();
		await app.request('/s', { signal: controller.signal });
		expect(seen?.aborted).toBe(false);
		controller.abort();
		expect(seen?.aborted).toBe(true);
	});

	test('a client leaving stops the run and closes the stream', async () => {
		const model = fakeModel([{ text: 'slow', delayMs: 5000 }]);
		const ends: string[] = [];
		const app = build([{ onRunEnd: (r) => void ends.push(r.reason) }], model);
		const controller = new AbortController();
		const response = await app.request('/chat', { signal: controller.signal });
		const reader = response.body?.getReader();
		await reader?.read();
		controller.abort();
		await Bun.sleep(50);
		expect(ends).toEqual(['aborted']);
	});
});

describe('SSE framing', () => {
	test('sends the headers and one named block per event', async () => {
		const response = await build().request('/chat?lang=fr');
		expect(response.headers.get('content-type')).toContain('text/event-stream');
		expect(response.headers.get('cache-control')).toBe('no-cache');
		expect(response.headers.get('x-accel-buffering')).toBe('no');
		const body = await response.text();
		const blocks = body.trim().split('\n\n');
		for (const block of blocks) {
			const lines = block.split('\n');
			expect(lines[0]).toMatch(/^event: [a-z-]+$/);
			expect(lines[1]).toMatch(/^data: \{.*\}$/);
		}
		expect(blocks.at(-1)).toStartWith('event: done');
	});

	test('line breaks and special characters stay on one data line', async () => {
		const model = fakeModel([{ text: 'a\nb\r\nc   "q" \\ é' }]);
		const body = await (await build([], model).request('/chat')).text();
		for (const line of body.split('\n')) {
			if (line === '') continue;
			expect(line).toMatch(/^(event|data): /);
		}
		const deltas = body
			.split('\n')
			.filter((l) => l.startsWith('data: {"type":"text-delta"'))
			.map((l) => JSON.parse(l.slice(6)).text);
		expect(deltas.join('')).toBe('a\nb\r\nc   "q" \\ é');
	});

	test('a failing model sends an error event with a code and no message', async () => {
		const { AiError } = await import('@nxgt/ai-core');
		const model = fakeModel([
			{ error: new AiError('RATE_LIMITED', 'quota of org-9 spent') },
		]);
		const body = await (await build([], model).request('/chat')).text();
		expect(body).toContain(
			'event: error\ndata: {"type":"error","error":{"code":"RATE_LIMITED"}}',
		);
		expect(body).not.toContain('org-9');
	});
});
