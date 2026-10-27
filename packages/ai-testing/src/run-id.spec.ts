import { describe, expect, test } from 'bun:test';
import {
	type AgentObserver,
	agentEventSchema,
	defineTool,
	runAgent,
} from '@nxgt/ai-core';
import { z } from 'zod';
import { collect, fakeModel } from './index';

const user = [
	{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'go' }] },
];
const echo = defineTool({
	name: 'echo',
	description: 'Echoes',
	input: z.object({ v: z.string() }),
	execute: ({ v }) => ({ v }),
});

describe('runId', () => {
	test('every hook, the result and the step-start events share one id', async () => {
		const seen: string[] = [];
		const observer: AgentObserver = {
			onRunStart: (i) => void seen.push(i.runId),
			onModelStart: (i) => void seen.push(i.runId),
			onModelCall: (i) => void seen.push(i.runId),
			onToolStart: (i) => void seen.push(i.runId),
			onToolCall: (i) => void seen.push(i.runId),
			onRunEnd: (r) => void seen.push(r.runId),
		};
		const run = runAgent({
			model: fakeModel([
				{ toolCalls: [{ name: 'echo', input: { v: 'x' } }] },
				{ text: 'k' },
			]),
			messages: user,
			tools: [echo],
			observers: [observer],
			newId: () => 'run-fixed',
		});
		const events = await collect(run);
		const result = await run.result;
		expect(result.runId).toBe('run-fixed');
		expect(seen).toHaveLength(8);
		expect(new Set(seen)).toEqual(new Set(['run-fixed']));
		const starts = events.filter((e) => e.type === 'step-start');
		expect(starts).toHaveLength(2);
		for (const e of starts) expect(e.runId).toBe('run-fixed');
		expect(events[0]).toEqual({
			type: 'step-start',
			step: 1,
			runId: 'run-fixed',
		});
		for (const e of events)
			expect(agentEventSchema.safeParse(e).success).toBe(true);
	});

	test('runs get distinct ids by default', async () => {
		const ids = await Promise.all(
			[1, 2].map(
				async () =>
					(
						await runAgent({
							model: fakeModel([{ text: 'a' }]),
							messages: user,
						}).result
					).runId,
			),
		);
		expect(ids[0]).not.toBe(ids[1]);
		expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
	});
});
