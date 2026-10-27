import { describe, expect, test } from 'bun:test';
import type { Message, ModelRequest } from '@nxgt/ai-core';
import { buildBody } from './request';
import { chunked, events, json, setup, sse, sseFixture } from './test-helpers';

const user = (text: string): Message => ({
	role: 'user',
	parts: [{ type: 'text', text }],
});

const full: ModelRequest = {
	system: [{ text: 'rules' }, { text: 'more rules' }],
	tools: [
		{ name: 'a', description: 'A', inputSchema: { type: 'object' } },
		{ name: 'b', description: 'B', inputSchema: { type: 'object' } },
	],
	messages: [
		user('first'),
		{ role: 'assistant', parts: [{ type: 'text', text: 'ok' }] },
		user('second'),
	],
};

describe('cache breakpoints', () => {
	test('cache auto marks the last tool, last system block and last user turn', () => {
		expect(buildBody('m', full)).toMatchSnapshot();
	});

	test('uses at most 3 of the 4 breakpoints', () => {
		const count =
			JSON.stringify(buildBody('m', full)).split('cache_control').length - 1;
		expect(count).toBe(3);
	});

	test('cache off places none', () => {
		expect(
			JSON.stringify(buildBody('m', { ...full, cache: 'off' })),
		).not.toContain('cache_control');
	});

	test('a tool result turn is the last user turn', () => {
		const body = buildBody('m', {
			messages: [
				user('q'),
				{
					role: 'tool',
					parts: [
						{
							type: 'tool-result',
							callId: 'c',
							name: 'n',
							isError: false,
							output: 'x',
						},
					],
				},
			],
		}) as { messages: Array<{ content: Array<Record<string, unknown>> }> };
		expect(body.messages[0]?.content[0]?.['cache_control']).toBeUndefined();
		expect(body.messages[0]?.content.at(-1)?.['cache_control']).toEqual({
			type: 'ephemeral',
		});
	});
});

describe('thinking', () => {
	test('enables thinking with the budget, drops temperature, leaves room in max_tokens', () => {
		const body = buildBody('m', {
			messages: [user('hi')],
			temperature: 0.3,
			thinking: { budgetTokens: 2000 },
			cache: 'off',
		});
		expect(body).toMatchObject({
			thinking: { type: 'enabled', budget_tokens: 2000 },
			max_tokens: 6096,
		});
		expect(body).not.toHaveProperty('temperature');
	});

	test('raises max_tokens above the budget when maxTokens is too small', () => {
		const body = buildBody('m', {
			messages: [user('hi')],
			maxTokens: 500,
			thinking: { budgetTokens: 2000 },
			cache: 'off',
		});
		expect(body).toMatchObject({ max_tokens: 2001 });
	});

	test('raises a budget below the API minimum to 1024', () => {
		const body = buildBody('m', {
			messages: [user('hi')],
			thinking: {},
			cache: 'off',
		});
		expect(body).toMatchObject({ thinking: { budget_tokens: 1024 } });
	});

	test('a streamed thinking part comes back with its signature on the next turn', async () => {
		const first = setup([sse(chunked(sseFixture('stream-thinking-tool'), 33))]);
		const evs = await events(first.model, { messages: [user('Lyon?')] });
		const thinking = evs
			.filter((e) => e.type === 'thinking-delta')
			.reduce(
				(acc, e) => ({
					text: acc.text + e.text,
					signature: e.signature ?? acc.signature,
				}),
				{ text: '', signature: '' },
			);
		const second = setup([json('{}')]);
		await events(second.model, {
			cache: 'off',
			messages: [
				user('Lyon?'),
				{
					role: 'assistant',
					parts: [
						{ type: 'thinking', ...thinking },
						{
							type: 'tool-call',
							id: 'toolu_01',
							name: 'weather',
							input: { city: 'Lyon' },
						},
					],
				},
			],
		});
		const sent = second.calls[0]?.body as {
			messages: Array<{ content: unknown[] }>;
		};
		expect(sent.messages[1]?.content[0]).toEqual({
			type: 'thinking',
			thinking: 'Lyon, so the weather tool.',
			signature: 'EqQBCgIYAhIM',
		});
	});
});
