import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { AiError } from './errors';
import {
	type ProposedAction,
	rejectAction,
	runConfirmedAction,
	toProposedAction,
} from './proposed-action';
import { defineTool } from './tool';

const runs: string[] = [];
const pay = defineTool({
	name: 'pay',
	description: 'Pays',
	input: z.object({ invoice: z.string() }),
	confirm: true,
	execute: ({ invoice }) => {
		runs.push(invoice);
		if (invoice === 'boom') throw new Error('bank down');
		return { paid: invoice };
	},
});
const pending = (over: Partial<ProposedAction> = {}): ProposedAction => ({
	id: 'p1',
	tool: 'pay',
	input: { invoice: 'A1' },
	status: 'pending',
	expiresAt: 100,
	...over,
});
const at = (t: number) => ({ now: () => t });
const code = (p: Promise<unknown>) =>
	p.then(
		() => 'none',
		(e: unknown) => (e instanceof AiError ? e.code : 'other'),
	);

describe('runConfirmedAction', () => {
	test('runs the tool once and returns a confirmed copy', async () => {
		runs.length = 0;
		const action = pending();
		const done = await runConfirmedAction(action, [pay], {}, at(50));
		expect(done).toMatchObject({
			status: 'confirmed',
			result: { isError: false, output: { paid: 'A1' }, callId: 'p1' },
		});
		expect(action.status).toBe('pending');
		expect(runs).toEqual(['A1']);
	});

	test('refuses an expired action without running it', async () => {
		runs.length = 0;
		expect(await code(runConfirmedAction(pending(), [pay], {}, at(100)))).toBe(
			'ACTION_EXPIRED',
		);
		expect(runs).toEqual([]);
	});

	test.each(['confirmed', 'rejected', 'expired', 'failed'] as const)(
		'refuses a %s action',
		async (status) => {
			runs.length = 0;
			const result = await code(
				runConfirmedAction(pending({ status }), [pay], {}, at(1)),
			);
			expect(result).toBe('ACTION_NOT_PENDING');
			expect(runs).toEqual([]);
		},
	);

	test('refuses input that no longer validates', async () => {
		runs.length = 0;
		const action = pending({ input: { invoice: 3 } });
		expect(await code(runConfirmedAction(action, [pay], {}, at(1)))).toBe(
			'INVALID_TOOL_INPUT',
		);
		expect(runs).toEqual([]);
	});

	test('refuses an unknown tool', async () => {
		expect(await code(runConfirmedAction(pending(), [], {}, at(1)))).toBe(
			'UNKNOWN_TOOL',
		);
	});

	test('a throwing tool gives a failed action', async () => {
		const action = pending({ input: { invoice: 'boom' } });
		const done = await runConfirmedAction(action, [pay], {}, at(1));
		expect(done.status).toBe('failed');
		expect(done.result).toMatchObject({
			isError: true,
			error: { code: 'TOOL_FAILED' },
		});
	});
});

describe('rejectAction and toProposedAction', () => {
	test('reject marks a pending action, only once', () => {
		const rejected = rejectAction(pending(), at(1));
		expect(rejected.status).toBe('rejected');
		expect(() => rejectAction(rejected)).toThrow(AiError);
	});

	test('a part becomes a pending action', () => {
		expect(
			toProposedAction({
				type: 'proposed-action',
				id: 'x',
				tool: 'pay',
				input: {},
				expiresAt: 5,
			}),
		).toEqual({
			id: 'x',
			tool: 'pay',
			input: {},
			status: 'pending',
			expiresAt: 5,
		});
	});
});
