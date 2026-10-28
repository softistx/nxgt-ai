import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { AiError } from './errors';
import {
	actionOutcomeMessage,
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

describe('abort', () => {
	test('an abort rejects and leaves the action untouched', async () => {
		const slow = defineTool({
			name: 'slow',
			description: 'Waits',
			input: z.object({}),
			confirm: true,
			execute: (_input, { signal }) =>
				new Promise((_resolve, reject) =>
					signal.addEventListener('abort', () => reject(signal.reason)),
				),
		});
		const action = pending({ tool: 'slow', input: {} });
		const controller = new AbortController();
		const run = runConfirmedAction(
			action,
			[slow],
			{ signal: controller.signal },
			at(1),
		);
		controller.abort(new Error('stop'));
		await expect(run).rejects.toThrow('stop');
		expect(action.status).toBe('pending');
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

describe('actionOutcomeMessage', () => {
	const text = (m: ReturnType<typeof actionOutcomeMessage>) =>
		m.parts[0]?.type === 'text' ? m.parts[0].text : '';

	test('a confirmed action reports its output in a user text turn', async () => {
		const done = await runConfirmedAction(pending(), [pay], {}, at(50));
		const message = actionOutcomeMessage(done);
		expect(message.role).toBe('user');
		expect(message.parts).toHaveLength(1);
		expect(text(message)).toContain('confirmed');
		expect(text(message)).toContain('{"paid":"A1"}');
	});

	test('names the summary when there is one', () => {
		const rejected = rejectAction(
			pending({ summary: 'Pay invoice A1' }),
			at(5),
		);
		expect(text(actionOutcomeMessage(rejected))).toContain('Pay invoice A1');
	});

	test('a rejected action carries the optional reason', () => {
		const rejected = rejectAction(pending(), at(5));
		expect(text(actionOutcomeMessage(rejected))).toContain('rejected');
		expect(
			text(actionOutcomeMessage(rejected, { reason: 'wrong invoice' })),
		).toContain('Reason given by the user: wrong invoice');
		expect(text(actionOutcomeMessage(rejected))).not.toContain('Reason');
	});

	test('a failed action gives the error code, never the error text', async () => {
		const failed = await runConfirmedAction(
			pending({ input: { invoice: 'boom' } }),
			[pay],
			{},
			at(50),
		);
		expect(failed.status).toBe('failed');
		const out = text(actionOutcomeMessage(failed));
		expect(out).toContain('failed');
		expect(out).toContain('TOOL_FAILED');
		expect(out).not.toContain('bank down');
	});

	test('an expired action is reported, a pending one refused', () => {
		expect(
			text(actionOutcomeMessage(pending({ status: 'expired' }))),
		).toContain('expired');
		expect(() => actionOutcomeMessage(pending())).toThrow(
			expect.objectContaining({ code: 'ACTION_NOT_PENDING' }),
		);
	});

	test('a long output is cut', () => {
		const big = pending({
			status: 'confirmed',
			result: {
				type: 'tool-result',
				callId: 'p1',
				name: 'pay',
				isError: false,
				output: 'x'.repeat(5_000),
			},
		});
		expect(text(actionOutcomeMessage(big)).length).toBeLessThan(2_200);
	});
});
