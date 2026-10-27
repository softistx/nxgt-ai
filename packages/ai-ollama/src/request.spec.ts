import { describe, expect, test } from 'bun:test';
import type { ModelRequest } from '@nxgt/ai-core';
import { buildBody } from './request';

const o = { model: 'm', keepAlive: undefined, think: undefined };
const text = (t: string) => ({ type: 'text' as const, text: t });

describe('buildBody', () => {
	test('maps system, messages, tool calls and results', () => {
		const req: ModelRequest = {
			system: [{ text: 'A' }, { text: 'B' }],
			messages: [
				{ role: 'user', parts: [text('Lyon?')] },
				{
					role: 'assistant',
					parts: [
						{ type: 'thinking', text: 'hmm' },
						text('Checking.'),
						{ type: 'tool-call', id: 'c1', name: 'weather', input: { c: 1 } },
					],
				},
				{
					role: 'tool',
					parts: [
						{
							type: 'tool-result',
							callId: 'c1',
							name: 'weather',
							isError: false,
							output: { temp: 18 },
						},
						{
							type: 'tool-result',
							callId: 'c2',
							name: 'time',
							isError: true,
							error: { code: 'TOOL_FAILED', message: 'boom' },
						},
					],
				},
			],
		};
		expect(buildBody(o, req)).toEqual({
			model: 'm',
			stream: true,
			messages: [
				{ role: 'system', content: 'A\n\nB' },
				{ role: 'user', content: 'Lyon?' },
				{
					role: 'assistant',
					content: 'Checking.',
					thinking: 'hmm',
					tool_calls: [{ function: { name: 'weather', arguments: { c: 1 } } }],
				},
				{ role: 'tool', content: '{"temp":18}', tool_name: 'weather' },
				{
					role: 'tool',
					content: '{"code":"TOOL_FAILED","message":"boom"}',
					tool_name: 'time',
				},
			],
		});
	});

	test('maps tools, sampling, think and keep_alive; ignores cache', () => {
		const body = buildBody(
			{ model: 'm', keepAlive: '10m', think: 'low' },
			{
				messages: [{ role: 'user', parts: [text('x')] }],
				tools: [
					{
						name: 'w',
						description: 'd',
						inputSchema: { type: 'object', properties: {} },
					},
				],
				temperature: 0.2,
				maxTokens: 50,
				cache: 'auto',
			},
		);
		expect(body).toMatchObject({
			tools: [
				{
					type: 'function',
					function: {
						name: 'w',
						description: 'd',
						parameters: { type: 'object', properties: {} },
					},
				},
			],
			options: { temperature: 0.2, num_predict: 50 },
			think: 'low',
			keep_alive: '10m',
		});
	});

	test('a thinking request turns think on; the option wins', () => {
		const req: ModelRequest = { messages: [], thinking: { budgetTokens: 5 } };
		expect(buildBody(o, req)['think']).toBe(true);
		expect(buildBody({ ...o, think: false }, req)['think']).toBe(false);
		expect(buildBody(o, { messages: [] })['think']).toBeUndefined();
	});

	test('providerOptions override the body', () => {
		const body = buildBody(o, {
			messages: [],
			providerOptions: { format: 'json', options: { seed: 1 } },
		});
		expect(body).toMatchObject({ format: 'json', options: { seed: 1 } });
	});
});
