import { describe, expect, test } from 'bun:test';
import { generate } from '@nxgt/ai-core';
import { ollama } from './ollama';
import { chunked, fixture, ndjson, setup } from './test-helpers';

describe('ollama()', () => {
	test('identifies the provider and model', () => {
		const m = ollama({ model: 'llama3.2' });
		expect([m.provider, m.model]).toEqual(['ollama', 'llama3.2']);
	});

	test('uses baseUrl without trailing slash, keepAlive and think', async () => {
		const { model, calls } = setup(
			[ndjson(chunked(fixture('stream-text'), 99))],
			{
				baseUrl: 'http://gpu-box:11434//',
				keepAlive: '30m',
				think: true,
			},
		);
		for await (const _ of model.stream(
			{ messages: [] },
			new AbortController().signal,
		));
		expect(calls[0]?.url).toBe('http://gpu-box:11434/api/chat');
		expect(calls[0]?.body).toMatchObject({ keep_alive: '30m', think: true });
		expect(calls[0]?.headers['content-type']).toBe('application/json');
	});

	test('works with generate()', async () => {
		const { model } = setup([
			ndjson(chunked(fixture('stream-thinking-tool'), 50)),
		]);
		const out = await generate(model, {
			messages: [{ role: 'user', parts: [{ type: 'text', text: 'Lyon?' }] }],
		});
		expect(
			out.message.parts.filter((p) => p.type === 'tool-call'),
		).toHaveLength(2);
		expect(out.usage.inputTokens).toBe(169);
	});
});
