# The model port

`ModelAdapter` is what every provider package implements. The agent loop and
`generate` only know this port.

```ts
import { generate, type ModelAdapter } from '@nxgt/ai-core';

const model: ModelAdapter = {
	provider: 'example',
	model: 'example-1',
	async *stream(req, signal) {
		yield { type: 'text-delta', text: 'Hello' };
		yield {
			type: 'usage',
			usage: {
				inputTokens: 5,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		};
		yield { type: 'finish', reason: 'end' };
	},
};

const { message, usage, finishReason } = await generate(
	model,
	{
		system: [{ text: 'Be brief.' }],
		messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
	},
	AbortSignal.timeout(30_000),
);
```

## ModelRequest

| field             | meaning                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `system`          | blocks of `{ text }`; an adapter may cache each block                |
| `messages`        | the conversation, see [Messages](messages.md)                        |
| `tools`           | `ToolSpec[]`, from `toolSpec(tool)`                                  |
| `maxTokens`       | output limit                                                         |
| `temperature`     | sampling temperature                                                 |
| `cache`           | `'auto'` (default) lets the adapter place cache breakpoints; `'off'` |
| `thinking`        | `{ budgetTokens }`; ignored by a model without thinking              |
| `providerOptions` | passed through untouched for what the port does not model            |

## ModelEvent

`text-delta`, `thinking-delta` (with the `signature` when the provider gives
one, or `redacted` for an opaque block that `generate` keeps as its own part), `tool-call` (complete: `id`, `name`, parsed `input`), `usage` and exactly
one `finish` with a reason: `end`, `tool-use`, `max-tokens` or `refusal`.

## generate

`generate(model, req, signal?)` folds one call into `{ message, usage,
finishReason }`. Consecutive deltas of one kind join into one part; usage events
are summed.

## Abort and errors

- When `signal` aborts, `generate` throws `AiError` with code `ABORTED`, even
  if the adapter failed with its own error because of the abort. An adapter
  passes `signal` to `fetch` and stops its stream when it aborts.
- A provider failure is an `AiError` (`MODEL_ERROR`, `RATE_LIMITED`,
  `AUTHENTICATION`) thrown from the stream; `generate` rethrows it.
- A stream that ends without `finish` is a `MODEL_ERROR`.

## AgentEvent

`runAgent` (a later slice) emits `AgentEvent`s: `step-start`, `text-delta`,
`thinking-delta`, `tool-call`, `tool-result`, `proposed-action`, `message`,
`usage`, `error` and a final `done` with a `reason`. `agentEventSchema` is the
Zod schema of the union, for reading events back from a stream:

```ts
import { agentEventSchema } from '@nxgt/ai-core';

const event = agentEventSchema.parse(JSON.parse(line));
```
