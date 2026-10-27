#!/usr/bin/env bun

import { generate, type Message, type ToolSpec } from '../packages/ai-core/src';
/**
 * Local smoke test of @nxgt/ai-ollama against a running Ollama server: streams
 * a short answer, then a tool call round trip. It needs the model pulled
 * (`ollama pull llama3.2`) and never runs in CI.
 *
 *   bun run smoke:ollama
 *   OLLAMA_MODEL=qwen3 OLLAMA_URL=http://localhost:11434 bun run smoke:ollama
 */
import { ollama } from '../packages/ai-ollama/src';

const model = ollama({
	model: process.env.OLLAMA_MODEL ?? 'llama3.2',
	...(process.env.OLLAMA_URL ? { baseUrl: process.env.OLLAMA_URL } : {}),
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
const first = await generate(model, { messages: turn1, tools: [weather] });
const call = first.message.parts.find((p) => p.type === 'tool-call');
console.log('tool call:', call?.type === 'tool-call' ? call.input : 'none');
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
	});
	console.log(
		'round trip:',
		JSON.stringify(second.message.parts.at(-1)),
		second.usage,
	);
} else {
	console.log('This model made no tool call: tool support varies by model.');
}
