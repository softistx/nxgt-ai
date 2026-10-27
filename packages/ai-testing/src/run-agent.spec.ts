import { describe, expect, test } from 'bun:test';
import {
	type AgentEvent,
	type AgentObserver,
	agentEventSchema,
	defineTool,
	runAgent,
} from '@nxgt/ai-core';
import { z } from 'zod';
import { collect, fakeModel } from './index';

const usage = (n: number) => ({
	inputTokens: n,
	outputTokens: n,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
});
const user = [
	{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'go' }] },
];
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const echo = defineTool({
	name: 'echo',
	description: 'Echoes its input',
	input: z.object({ v: z.string() }),
	execute: ({ v }) => ({ v }),
});
const call = (name: string, input: unknown = { v: 'x' }) => ({ name, input });
const types = (events: AgentEvent[]) => events.map((e) => e.type);

describe('runAgent', () => {
	test('one step without tools', async () => {
		const model = fakeModel([{ text: 'hello', chunk: 2, usage: usage(3) }]);
		const run = runAgent({ model, system: 'Be brief.', messages: user });
		const events = await collect(run);
		const result = await run.result;
		expect(types(events)).toEqual([
			'step-start',
			'text-delta',
			'text-delta',
			'text-delta',
			'usage',
			'message',
			'done',
		]);
		expect(result).toMatchObject({ reason: 'end', text: 'hello', steps: 1 });
		expect(model.requests[0]?.system).toEqual([{ text: 'Be brief.' }]);
		for (const event of events) agentEventSchema.parse(event);
	});

	test('multi-step: tool results go back to the model', async () => {
		const model = fakeModel([
			{ toolCalls: [call('echo')], usage: usage(1) },
			{ text: 'done', usage: usage(2) },
		]);
		const run = runAgent({ model, messages: user, tools: [echo] });
		const events = await collect(run);
		const result = await run.result;
		expect(result.reason).toBe('end');
		expect(result.steps).toBe(2);
		expect(result.usage).toEqual(usage(3));
		expect(result.messages.map((m) => m.role)).toEqual([
			'assistant',
			'tool',
			'assistant',
		]);
		expect(model.requests[1]?.messages.map((m) => m.role)).toEqual([
			'user',
			'assistant',
			'tool',
		]);
		expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'end' });
		expect(model.requests[0]?.tools?.[0]?.name).toBe('echo');
	});

	test('parallel calls run together and answer in call order', async () => {
		const slow = defineTool({
			name: 'slow',
			description: 'Slow',
			input: z.object({ ms: z.number() }),
			execute: async ({ ms }) => {
				await delay(ms);
				return ms;
			},
		});
		const model = fakeModel([
			{
				toolCalls: [call('slow', { ms: 60 }), call('slow', { ms: 5 })],
			},
			{ text: 'ok' },
		]);
		const run = runAgent({ model, messages: user, tools: [slow] });
		const started = performance.now();
		const events = await collect(run);
		expect(performance.now() - started).toBeLessThan(110);
		const finished = events.flatMap((e) =>
			e.type === 'tool-result' ? [e.result.callId] : [],
		);
		expect(finished).toEqual(['call_0_1', 'call_0_0']);
		const toolMessage = (await run.result).messages[1];
		expect(
			toolMessage?.parts.map((p) => p.type === 'tool-result' && p.callId),
		).toEqual(['call_0_0', 'call_0_1']);
	});

	test('a throwing tool, an unknown tool and bad input answer as errors', async () => {
		const boom = defineTool({
			name: 'boom',
			description: 'Throws',
			input: z.object({}),
			execute: () => {
				throw new Error('kaput');
			},
		});
		const model = fakeModel([
			{
				toolCalls: [call('boom', {}), call('nope'), call('echo', { v: 1 })],
			},
			{ text: 'recovered' },
		]);
		const run = runAgent({ model, messages: user, tools: [boom, echo] });
		await collect(run);
		const result = await run.result;
		expect(result.text).toBe('recovered');
		const codes = result.messages[1]?.parts.map((p) =>
			p.type === 'tool-result' && p.isError ? p.error.code : 'ok',
		);
		expect(codes).toEqual([
			'TOOL_FAILED',
			'UNKNOWN_TOOL',
			'INVALID_TOOL_INPUT',
		]);
	});

	test('observers see the run, the calls and the end', async () => {
		const log: string[] = [];
		const observer: AgentObserver = {
			onRunStart: (i) => void log.push(`start ${i.provider} ${i.tools}`),
			onModelCall: (i) => void log.push(`model ${i.step} ${i.finishReason}`),
			onToolCall: (i) => void log.push(`tool ${i.call.name}`),
			onRunEnd: (r) => void log.push(`end ${r.reason}`),
		};
		const broken: AgentObserver = {
			onRunStart: () => {
				throw new Error('ignored');
			},
		};
		const model = fakeModel([{ toolCalls: [call('echo')] }, { text: 'k' }]);
		const run = runAgent({
			model,
			messages: user,
			tools: [echo],
			observers: [broken, observer],
		});
		await run.result;
		expect(log).toEqual([
			'start fake echo',
			'model 1 tool-use',
			'tool echo',
			'model 2 end',
			'end end',
		]);
	});

	test('context reaches the tools and the input messages are untouched', async () => {
		const who = defineTool({
			name: 'who',
			description: 'Reads the context',
			input: z.object({}),
			execute: (_i, { context }) => context,
		});
		const model = fakeModel([{ toolCalls: [call('who', {})] }, { text: 'k' }]);
		const messages = [...user];
		const run = runAgent({
			model,
			messages,
			tools: [who],
			context: { viewer: 'u1' },
		});
		const result = await run.result;
		expect(messages).toEqual(user);
		expect(result.messages[1]?.parts[0]).toMatchObject({
			output: { viewer: 'u1' },
		});
	});
});
