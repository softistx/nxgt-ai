import { describe, expect, test } from 'bun:test';
import {
	type AgentEvent,
	defineTool,
	type ProposedAction,
	rejectAction,
	runAgent,
	runConfirmedAction,
	toProposedAction,
} from '@nxgt/ai-core';
import { z } from 'zod';
import { collect, fakeModel } from './index';

const user = [
	{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'go' }] },
];

function setup() {
	const runs: unknown[] = [];
	const pay = defineTool({
		name: 'pay',
		description: 'Pays an invoice',
		input: z.object({ invoice: z.string() }),
		confirm: true,
		execute: ({ invoice }) => {
			runs.push(invoice);
			return { paid: invoice };
		},
	});
	return { runs, pay };
}

const propose = (input: unknown) =>
	fakeModel([
		{ toolCalls: [{ name: 'pay', input }] },
		{ text: 'waiting for you' },
	]);

describe('proposed actions in the loop', () => {
	test('a confirm tool is proposed, never executed', async () => {
		const { runs, pay } = setup();
		const model = propose({ invoice: 'A1' });
		let now = 1_000;
		const run = runAgent({
			model,
			messages: user,
			tools: [pay],
			proposalTtlMs: 500,
			now: () => now,
		});
		const events: AgentEvent[] = await collect(run);
		const result = await run.result;
		now += 1;
		expect(runs).toEqual([]);
		const proposed = events.find((e) => e.type === 'proposed-action');
		expect(proposed).toMatchObject({
			action: { tool: 'pay', input: { invoice: 'A1' }, expiresAt: 1_500 },
		});
		const toolMessage = result.messages.find((m) => m.role === 'tool');
		expect(toolMessage?.parts[0]).toMatchObject({
			type: 'tool-result',
			isError: false,
			output: {
				status: 'pending',
				actionId: (proposed as never as { action: { id: string } }).action.id,
			},
		});
		expect(toolMessage?.parts[1]).toMatchObject({ type: 'proposed-action' });
		expect(result.reason).toBe('end');
	});

	test('a proposal with invalid input is an error result, not a proposal', async () => {
		const { runs, pay } = setup();
		const run = runAgent({
			model: propose({ invoice: 3 }),
			messages: user,
			tools: [pay],
		});
		const events = await collect(run);
		const result = await run.result;
		expect(events.some((e) => e.type === 'proposed-action')).toBe(false);
		expect(result.messages.find((m) => m.role === 'tool')?.parts).toMatchObject(
			[{ isError: true, error: { code: 'INVALID_TOOL_INPUT' } }],
		);
		expect(runs).toEqual([]);
	});

	test('the proposal can be confirmed once, and not twice', async () => {
		const { runs, pay } = setup();
		const run = runAgent({
			model: propose({ invoice: 'A1' }),
			messages: user,
			tools: [pay],
			now: () => 0,
		});
		const result = await (async () => {
			await collect(run);
			return run.result;
		})();
		const part = result.messages
			.flatMap((m) => m.parts)
			.find((p) => p.type === 'proposed-action');
		if (part?.type !== 'proposed-action') throw new Error('no proposal');
		const action: ProposedAction = toProposedAction(part);
		const done = await runConfirmedAction(action, [pay], {}, { now: () => 1 });
		expect(done.status).toBe('confirmed');
		expect(done.result).toMatchObject({
			isError: false,
			output: { paid: 'A1' },
		});
		expect(runs).toEqual(['A1']);
		await expect(
			runConfirmedAction(done, [pay], {}, { now: () => 1 }),
		).rejects.toMatchObject({ code: 'ACTION_NOT_PENDING' });
		expect(runs).toEqual(['A1']);
		expect(rejectAction(action, { now: () => 1 }).status).toBe('rejected');
	});
});
