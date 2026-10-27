# Messages

A conversation is a list of `Message`; a message is a `role` and its `parts`.
Everything is plain JSON, so a message can be stored and read back unchanged.

```ts
import type { Message } from '@nxgt/ai-core';

const conversation: Message[] = [
	{ role: 'user', parts: [{ type: 'text', text: 'Weather in Lyon?' }] },
	{
		role: 'assistant',
		parts: [
			{ type: 'thinking', text: 'I should call the tool.', signature: 'sig…' },
			{ type: 'tool-call', id: 'c1', name: 'weather', input: { city: 'Lyon' } },
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
				output: { degrees: 18 },
			},
		],
	},
	{ role: 'assistant', parts: [{ type: 'text', text: 'It is 18 degrees.' }] },
];
```

## Parts

| `type`            | Fields                                                                           | Notes                                                                |
| ----------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `text`            | `text`                                                                           |                                                                      |
| `thinking`        | `text`, `signature?`                                                             | Send `signature` back unchanged; a provider checks it.               |
| `tool-call`       | `id`, `name`, `input`                                                            | `input` is what the model sent, **not validated**.                   |
| `tool-result`     | `callId`, `name`, then `isError: false` + `output`, or `isError: true` + `error` | `callId` is the call's `id`.`error` is `{ code, message, issues? }`. |
| `proposed-action` | `id`, `tool`, `input`, `summary?`                                                | A mutation waiting for a confirmation.                               |

Switch on `part.type`; the compiler narrows each branch, and a `default` branch
with `part satisfies never` tells you when a new part type is added.

## Usage

```ts
import { addUsage, emptyUsage } from '@nxgt/ai-core';

let total = emptyUsage();
total = addUsage(total, {
	inputTokens: 1200,
	outputTokens: 80,
	cacheReadTokens: 1000,
	cacheWriteTokens: 0,
});
```

`cacheReadTokens` and `cacheWriteTokens` count the provider's prompt cache and
are `0` when it reports none.
