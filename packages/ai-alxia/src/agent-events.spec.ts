import { describe, expect, test } from 'bun:test';
import { AiError, runAgent } from '@nxgt/ai-core';
import { collect, fakeModel } from '@nxgt/ai-testing';
import { agentEvents } from './agent-events';

const user = [
	{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }] },
];

describe('agentEvents', () => {
	test('yields each event under its type and stops after done', async () => {
		const run = runAgent({
			model: fakeModel([{ text: 'Hello' }]),
			messages: user,
		});
		const items = await collect(agentEvents(run));
		const names = items.map((i) => (i as { event: string }).event);
		expect(names[0]).toBe('step-start');
		expect(names).toContain('text-delta');
		expect(names.at(-1)).toBe('done');
	});

	test('an error event carries a code and no message', async () => {
		const model = fakeModel([
			{ error: new AiError('MODEL_ERROR', 'secret provider detail sk-123') },
		]);
		const items = await collect(
			agentEvents(runAgent({ model, messages: user })),
		);
		const text = JSON.stringify(items);
		expect(text).toContain('"code":"MODEL_ERROR"');
		expect(text).not.toContain('secret');
		expect(text).not.toContain('sk-123');
		expect((items.at(-1) as { event: string }).event).toBe('done');
	});

	test('a failed tool result keeps its code only', async () => {
		const model = fakeModel([
			{ toolCalls: [{ name: 'missing', input: {} }] },
			{ text: 'x' },
		]);
		const items = await collect(
			agentEvents(runAgent({ model, messages: user })),
		);
		const result = items.find(
			(i) => (i as { event: string }).event === 'tool-result',
		) as unknown as {
			data: { result: { error: Record<string, unknown> } };
		};
		expect(Object.keys(result.data.result.error)).toEqual(['code']);
	});

	test('a failing run ends with an INTERNAL_ERROR event, no message', async () => {
		const run = runAgent({ model: fakeModel([{ text: 'a' }]), messages: user });
		const broken = {
			...run,
			abort: () => run.abort(),
			result: run.result,
			[Symbol.asyncIterator]: () => ({
				next: () => Promise.reject(new Error('db password is hunter2')),
			}),
		};
		const items = await collect(agentEvents(broken as never));
		expect(items).toEqual([
			{
				event: 'error',
				data: { type: 'error', error: { code: 'INTERNAL_ERROR' } },
			},
		]);
	});

	test('aborting the signal aborts the run and closes the stream', async () => {
		const controller = new AbortController();
		const model = fakeModel([{ text: 'slow', delayMs: 5000 }]);
		const run = runAgent({ model, messages: user, signal: controller.signal });
		const stream = collect(agentEvents(run, { signal: controller.signal }));
		setTimeout(() => controller.abort(), 20);
		const items = await stream;
		expect((await run.result).reason).toBe('aborted');
		expect(items.at(-1)).not.toHaveProperty('event', 'done');
	});

	test('closing the generator aborts the run', async () => {
		const model = fakeModel([{ text: 'a', delayMs: 5000 }]);
		const run = runAgent({ model, messages: user });
		const generator = agentEvents(run);
		await generator.next(); // step-start
		await generator.return(undefined);
		expect((await run.result).reason).toBe('aborted');
	});

	test('writes a heartbeat comment while the run is silent', async () => {
		const model = fakeModel([{ text: 'late', delayMs: 120 }]);
		const run = runAgent({ model, messages: user });
		const items = await collect(agentEvents(run, { heartbeatMs: 30 }));
		const beats = items.filter((i) => !('event' in i));
		expect(beats.length).toBeGreaterThanOrEqual(2);
		expect((items.at(-1) as { event: string }).event).toBe('done');
	});

	test('no heartbeat by default', async () => {
		const run = runAgent({ model: fakeModel([{ text: 'a' }]), messages: user });
		const items = await collect(agentEvents(run));
		expect(items.every((i) => 'event' in i)).toBe(true);
	});
});
