import { describe, expect, test } from 'bun:test';
import { AiError, type Message, type ModelRequest } from '@nxgt/ai-core';
import { buildBody } from './request';
import { events, fixture, json, setup } from './test-helpers';

const messages: Message[] = [
	{ role: 'user', parts: [{ type: 'text', text: 'Weather in Lyon?' }] },
	{
		role: 'assistant',
		parts: [
			{ type: 'thinking', text: 'hmm', signature: 'sig' },
			{ type: 'thinking', text: 'no signature' },
			{ type: 'text', text: 'Checking.' },
			{
				type: 'tool-call',
				id: 'toolu_1',
				name: 'weather',
				input: { city: 'Lyon' },
			},
		],
	},
	{
		role: 'tool',
		parts: [
			{
				type: 'tool-result',
				callId: 'toolu_1',
				name: 'weather',
				isError: false,
				output: { temp: 18 },
			},
			{
				type: 'tool-result',
				callId: 'toolu_2',
				name: 'x',
				isError: true,
				error: { code: 'TOOL_FAILED', message: 'boom' },
			},
		],
	},
	{ role: 'user', parts: [{ type: 'text', text: 'And now?' }] },
];

describe('buildBody', () => {
	test('maps system, messages, tools and sampling', () => {
		const body = buildBody('claude-test', {
			cache: 'off',
			system: [{ text: 'Be brief.' }, { text: 'French.' }],
			messages,
			tools: [
				{
					name: 'weather',
					description: 'Weather of a city',
					inputSchema: {
						type: 'object',
						properties: { city: { type: 'string' } },
					},
				},
			],
			maxTokens: 100,
			temperature: 0.2,
		});
		expect(body).toEqual({
			model: 'claude-test',
			max_tokens: 100,
			temperature: 0.2,
			system: [
				{ type: 'text', text: 'Be brief.' },
				{ type: 'text', text: 'French.' },
			],
			tools: [
				{
					name: 'weather',
					description: 'Weather of a city',
					input_schema: {
						type: 'object',
						properties: { city: { type: 'string' } },
					},
				},
			],
			messages: [
				{ role: 'user', content: [{ type: 'text', text: 'Weather in Lyon?' }] },
				{
					role: 'assistant',
					content: [
						{ type: 'thinking', thinking: 'hmm', signature: 'sig' },
						{ type: 'text', text: 'Checking.' },
						{
							type: 'tool_use',
							id: 'toolu_1',
							name: 'weather',
							input: { city: 'Lyon' },
						},
					],
				},
				{
					// tool results and the next user turn share one user message
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: 'toolu_1',
							content: '{"temp":18}',
						},
						{
							type: 'tool_result',
							tool_use_id: 'toolu_2',
							content: '{"code":"TOOL_FAILED","message":"boom"}',
							is_error: true,
						},
						{ type: 'text', text: 'And now?' },
					],
				},
			],
		});
	});

	test('defaults max_tokens, omits empty system and tools, drops proposed actions', () => {
		const body = buildBody('m', {
			cache: 'off',
			system: [],
			tools: [],
			messages: [
				{ role: 'user', parts: [{ type: 'text', text: 'hi' }] },
				{
					role: 'assistant',
					parts: [
						{
							type: 'proposed-action',
							id: 'a',
							tool: 't',
							input: {},
							expiresAt: 9,
						},
					],
				},
			],
		});
		expect(body).toEqual({
			model: 'm',
			max_tokens: 4096,
			messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
		});
	});

	test('string tool output is sent as is; providerOptions win', () => {
		const body = buildBody('m', {
			messages: [
				{
					role: 'tool',
					parts: [
						{
							type: 'tool-result',
							callId: 'c',
							name: 'n',
							isError: false,
							output: 'plain',
						},
					],
				},
			],
			providerOptions: { top_k: 5, max_tokens: 9 },
		});
		expect(body).toMatchObject({ top_k: 5, max_tokens: 9 });
		expect(JSON.stringify(body)).toContain('"content":"plain"');
	});
});

describe('providerOptions thinking override', () => {
	const messages: ModelRequest['messages'] = [];
	const thinking = { type: 'enabled', budget_tokens: 8000 };

	test('max_tokens is sized for the overriding budget', () => {
		const body = buildBody('m', { messages, providerOptions: { thinking } });
		expect(body['thinking']).toEqual(thinking);
		expect(body['max_tokens']).toBe(4096 + 8000);
		const asked = buildBody('m', {
			messages,
			maxTokens: 100,
			providerOptions: { thinking },
		});
		expect(asked['max_tokens']).toBe(8001);
	});

	test('it replaces the budget of the typed option', () => {
		const body = buildBody('m', {
			messages,
			thinking: { budgetTokens: 2000 },
			providerOptions: { thinking },
		});
		expect(body['max_tokens']).toBe(4096 + 8000);
	});

	test('an explicit max_tokens in providerOptions wins', () => {
		const body = buildBody('m', {
			messages,
			providerOptions: { thinking, max_tokens: 20000 },
		});
		expect(body['max_tokens']).toBe(20000);
	});

	test('temperature is dropped unless providerOptions names it', () => {
		const req = { messages, temperature: 0.2 };
		const dropped = buildBody('m', { ...req, providerOptions: { thinking } });
		expect('temperature' in dropped).toBe(false);
		const kept = buildBody('m', {
			...req,
			providerOptions: { thinking, temperature: 1 },
		});
		expect(kept['temperature']).toBe(1);
	});

	test('the budget is raised to the minimum; adaptive keeps max_tokens', () => {
		const low = buildBody('m', {
			messages,
			providerOptions: { thinking: { type: 'enabled', budget_tokens: 10 } },
		});
		expect(low['thinking']).toEqual({ type: 'enabled', budget_tokens: 1024 });
		expect(low['max_tokens']).toBe(4096 + 1024);
		const adaptive = buildBody('m', {
			messages,
			temperature: 0.2,
			providerOptions: { thinking: { type: 'adaptive' } },
		});
		expect(adaptive['thinking']).toEqual({ type: 'adaptive' });
		expect(adaptive['max_tokens']).toBe(4096);
		expect('temperature' in adaptive).toBe(false);
	});

	test('other thinking values leave max_tokens alone', () => {
		const body = buildBody('m', {
			messages,
			providerOptions: { thinking: { type: 'disabled' } },
		});
		expect(body['max_tokens']).toBe(4096);
	});
});

describe('headers and response', () => {
	test('sends the key, version, beta and the Messages endpoint', async () => {
		const t = setup([json(fixture('message-text'))], {
			baseUrl: 'http://localhost:9999/',
			beta: ['a-2026', 'b-2026'],
			version: '2023-06-01',
		});
		await events(t.model, { messages });
		expect(t.calls[0]?.url).toBe('http://localhost:9999/v1/messages');
		expect(t.calls[0]?.headers).toMatchObject({
			'x-api-key': 'sk-test',
			'anthropic-version': '2023-06-01',
			'anthropic-beta': 'a-2026,b-2026',
		});
	});

	test('maps a text response with cache usage', async () => {
		const t = setup([json(fixture('message-text'))]);
		expect(await events(t.model, { messages })).toEqual([
			{ type: 'text-delta', text: 'It is 18 degrees.', start: true },
			{
				type: 'usage',
				usage: {
					// 12 plain + 3 cache read + 1 cache write
					inputTokens: 16,
					outputTokens: 7,
					cacheReadTokens: 3,
					cacheWriteTokens: 1,
				},
			},
			{ type: 'finish', reason: 'end' },
		]);
	});

	test('maps a tool_use response', async () => {
		const t = setup([json(fixture('message-tool-use'))]);
		const out = await events(t.model, { messages });
		expect(out).toContainEqual({
			type: 'tool-call',
			id: 'toolu_1',
			name: 'weather',
			input: { city: 'Lyon' },
		});
		expect(out.at(-1)).toEqual({ type: 'finish', reason: 'tool-use' });
	});
});

describe('buildBody thinking modes', () => {
	const messages: Message[] = [
		{ role: 'user', parts: [{ type: 'text', text: 'hi' }] },
	];
	const build = (thinking: ModelRequest['thinking'], model = 'claude-test') =>
		buildBody(model, {
			cache: 'off',
			messages,
			temperature: 0.3,
			...(thinking && { thinking }),
		});
	const refused = (thinking: ModelRequest['thinking']) => {
		try {
			build(thinking);
		} catch (e) {
			return e;
		}
		throw new Error('expected a refusal');
	};

	test('budgetTokens keeps sending an enabled budget', () => {
		const body = build({ budgetTokens: 2000 });
		expect(body['thinking']).toEqual({
			type: 'enabled',
			budget_tokens: 2000,
		});
		expect(body['max_tokens']).toBe(6096);
		expect(body['temperature']).toBeUndefined();
		expect(body['output_config']).toBeUndefined();
	});

	test('adaptive sends type adaptive, no budget, no temperature, the plain max_tokens', () => {
		const body = build({ mode: 'adaptive' });
		expect(body['thinking']).toEqual({ type: 'adaptive' });
		expect(body['max_tokens']).toBe(4096);
		expect(body['temperature']).toBeUndefined();
		expect(body['output_config']).toBeUndefined();
	});

	test('adaptive with effort and display; an explicit maxTokens is kept', () => {
		const body = buildBody('claude-opus-5-5', {
			cache: 'off',
			messages,
			maxTokens: 9000,
			thinking: { mode: 'adaptive', effort: 'xhigh', display: 'summarized' },
		});
		expect(body['thinking']).toEqual({
			type: 'adaptive',
			display: 'summarized',
		});
		expect(body['output_config']).toEqual({ effort: 'xhigh' });
		expect(body['max_tokens']).toBe(9000);
	});

	test('display goes with a budget too', () => {
		const body = build({ budgetTokens: 1024, display: 'omitted' });
		expect(body['thinking']).toEqual({
			type: 'enabled',
			budget_tokens: 1024,
			display: 'omitted',
		});
	});

	test('effort alone sends only output_config and keeps temperature', () => {
		const body = build({ effort: 'low' });
		expect(body['thinking']).toBeUndefined();
		expect(body['output_config']).toEqual({ effort: 'low' });
		expect(body['temperature']).toBe(0.3);
	});

	test('effort works beside a budget', () => {
		const body = build({ budgetTokens: 1024, effort: 'high' });
		expect(body['thinking']).toEqual({
			type: 'enabled',
			budget_tokens: 1024,
		});
		expect(body['output_config']).toEqual({ effort: 'high' });
	});

	test('the model id never decides: what only some models refuse is sent', () => {
		for (const model of ['claude-haiku-5-5', 'claude-haiku-4-5', 'x']) {
			expect(build({ budgetTokens: 2000 }, model)['thinking']).toEqual({
				type: 'enabled',
				budget_tokens: 2000,
			});
			expect(build({ mode: 'adaptive', effort: 'max' }, model)).toMatchObject({
				thinking: { type: 'adaptive' },
				output_config: { effort: 'max' },
			});
		}
	});

	test('refuses adaptive together with budgetTokens', () => {
		const e = refused({ mode: 'adaptive', budgetTokens: 2000 });
		expect(e).toBeInstanceOf(AiError);
		expect(e).toMatchObject({ code: 'INVALID_REQUEST' });
	});

	test('refuses display with effort alone', () => {
		expect(refused({ effort: 'low', display: 'omitted' })).toMatchObject({
			code: 'INVALID_REQUEST',
		});
	});

	test('a typed adaptive mode plus a providerOptions budget override: the override wins and is sized like a budget', () => {
		const body = buildBody('claude-test', {
			cache: 'off',
			messages,
			temperature: 0.3,
			thinking: { mode: 'adaptive', effort: 'high' },
			providerOptions: { thinking: { type: 'enabled', budget_tokens: 5000 } },
		});
		expect(body['thinking']).toEqual({ type: 'enabled', budget_tokens: 5000 });
		expect(body['output_config']).toEqual({ effort: 'high' });
		expect(body['max_tokens']).toBe(4096 + 5000);
		expect(body['temperature']).toBeUndefined();
	});

	test('providerOptions still win over the mapped fields', () => {
		const body = buildBody('claude-test', {
			cache: 'off',
			messages,
			thinking: { mode: 'adaptive' },
			providerOptions: { thinking: { type: 'adaptive', display: 'omitted' } },
		});
		expect(body['thinking']).toEqual({ type: 'adaptive', display: 'omitted' });
	});
});
