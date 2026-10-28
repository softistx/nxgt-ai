import { describe, expect, it } from 'bun:test';
import {
	actionOutcomeMessage,
	defineTool,
	type Message,
	runAgent,
	runConfirmedAction,
} from '@nxgt/ai-core';
import { collect, fakeModel } from '@nxgt/ai-testing';
import { z } from 'zod';
import { memoryStore } from './index';

const pay = defineTool({
	name: 'pay',
	description: 'Pays an invoice',
	input: z.object({ invoice: z.string() }),
	confirm: true,
	summarize: ({ invoice }) => `Pay invoice ${invoice}`,
	execute: ({ invoice }) => ({ paid: invoice }),
});

const say = (text: string): Message => ({
	role: 'user',
	parts: [{ type: 'text', text }],
});

describe('a confirmation in a later request', () => {
	it('tells the next run how the action ended', async () => {
		const store = memoryStore();
		const thread = await store.createThread({ ownerId: 'u1' });

		// Request 1: the model proposes; the run's messages are stored.
		await store.append(thread.id, 'u1', [say('pay A1')]);
		const first = runAgent({
			model: fakeModel([
				{ toolCalls: [{ name: 'pay', input: { invoice: 'A1' } }] },
				{ text: 'Waiting for your confirmation.' },
			]),
			messages: [say('pay A1')],
			tools: [pay],
		});
		await collect(first);
		const { messages } = await first.result;
		await store.append(thread.id, 'u1', messages);

		// Request 2: the user confirms; the outcome is stored as a message.
		const pending = await store.findAction('call_0_0', 'u1');
		expect(pending).toMatchObject({
			status: 'pending',
			summary: 'Pay invoice A1',
		});
		if (!pending) throw new Error('no pending action');
		const done = await runConfirmedAction(pending, [pay]);
		expect(
			await store.updateAction(pending.id, 'u1', {
				status: 'confirmed',
				...(done.result ? { result: done.result } : {}),
			}),
		).toBeDefined();
		await store.append(thread.id, 'u1', [actionOutcomeMessage(done)]);

		// Request 3: the next run sees the outcome after the earlier pending result.
		const loaded = await store.load(thread.id, 'u1', { sinceSummary: false });
		const model = fakeModel([{ text: 'Invoice A1 is paid.' }]);
		const next = runAgent({
			model,
			messages: [...(loaded?.messages.map((m) => m.message) ?? []), say('so?')],
			tools: [pay],
		});
		await collect(next);
		const sent = model.requests[0]?.messages ?? [];
		const texts = sent.flatMap((m) =>
			m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])),
		);
		expect(
			texts.some((t) => t.includes('confirmed') && t.includes('{"paid":"A1"}')),
		).toBe(true);
		expect(JSON.stringify(sent)).toContain('"status":"pending"');
	});
});
