import { describe, expect, test } from 'bun:test';
import { AnthropicError } from './errors';
import { json, setup } from './test-helpers';

const req = {
	system: [{ text: 'rules' }],
	messages: [
		{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }] },
	],
	temperature: 0.5,
	maxTokens: 10,
};

describe('countTokens', () => {
	test('posts to /v1/messages/count_tokens without output fields and returns input_tokens', async () => {
		const { model, calls } = setup([json('{"input_tokens":42}')]);
		expect(await model.countTokens?.(req)).toBe(42);
		expect(calls[0]?.url).toBe(
			'https://api.anthropic.com/v1/messages/count_tokens',
		);
		expect(calls[0]?.body).toEqual({
			model: 'claude-test',
			system: [
				{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } },
			],
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } },
					],
				},
			],
		});
	});

	test('retries and classifies errors like a call', async () => {
		const { model, calls } = setup([
			new Response('{"error":{"message":"busy"}}', { status: 529 }),
			json('{"input_tokens":3}'),
		]);
		expect(await model.countTokens?.(req)).toBe(3);
		expect(calls).toHaveLength(2);

		const bad = setup([
			new Response('{"error":{"message":"nope"}}', { status: 401 }),
		]);
		const error = await bad.model.countTokens?.(req).catch((e) => e);
		expect((error as AnthropicError).kind).toBe('auth');
	});

	test('rejects a body without input_tokens', async () => {
		const { model } = setup([json('{}')]);
		await expect(model.countTokens?.(req)).rejects.toBeInstanceOf(
			AnthropicError,
		);
	});

	test('ABORTED when the signal is already aborted', async () => {
		const { model } = setup([json('{"input_tokens":1}')]);
		const c = new AbortController();
		c.abort();
		await expect(model.countTokens?.(req, c.signal)).rejects.toMatchObject({
			code: 'ABORTED',
		});
	});
});
