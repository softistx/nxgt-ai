#!/usr/bin/env bun

import { anthropic } from '../packages/ai-anthropic/src';
/**
 * Local smoke test of @nxgt/ai-anthropic against the real API: streams a short
 * answer, then a thinking + tool call round trip, then counts tokens. It spends
 * a few cents, reads the key from the environment and never runs in CI.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... bun run smoke:anthropic
 *   ANTHROPIC_MODEL=claude-sonnet-4-5 bun run smoke:anthropic
 */
import { generate, type Message, type ToolSpec } from '../packages/ai-core/src';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
	console.error('Set ANTHROPIC_API_KEY to run the smoke test.');
	process.exit(1);
}
const model = anthropic({
	apiKey,
	model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
});
const ask = (text: string): Message => ({
	role: 'user',
	parts: [{ type: 'text', text }],
});

let streamed = '';
for await (const e of model.stream(
	{ messages: [ask('Say hello in five words.')], maxTokens: 50 },
	new AbortController().signal,
))
	if (e.type === 'text-delta') streamed += e.text;
console.log('stream:', streamed);

const weather: ToolSpec = {
	name: 'weather',
	description: 'Current weather of a city',
	inputSchema: {
		type: 'object',
		properties: { city: { type: 'string' } },
		required: ['city'],
	},
};
const turn1 = [ask('What is the weather in Lyon? Use the tool.')];
const first = await generate(model, {
	messages: turn1,
	tools: [weather],
	thinking: { budgetTokens: 1024 },
	maxTokens: 2000,
});
const call = first.message.parts.find((p) => p.type === 'tool-call');
const signed = first.message.parts.some(
	(p) => p.type === 'thinking' && p.signature,
);
console.log(
	'thinking signed:',
	signed,
	'| tool call:',
	call?.type === 'tool-call' ? call.input : 'none',
);
if (call?.type === 'tool-call') {
	const second = await generate(model, {
		messages: [
			...turn1,
			first.message,
			{
				role: 'tool',
				parts: [
					{
						type: 'tool-result',
						callId: call.id,
						name: call.name,
						isError: false,
						output: { temp: 18 },
					},
				],
			},
		],
		tools: [weather],
		thinking: { budgetTokens: 1024 },
		maxTokens: 2000,
	});
	console.log(
		'round trip:',
		JSON.stringify(second.message.parts.at(-1)),
		second.usage,
	);
}
console.log(
	'count_tokens:',
	await model.countTokens?.({ messages: turn1, tools: [weather] }),
);
