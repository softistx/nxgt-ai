# @nxgt/ai-anthropic

The Anthropic Messages API as an `@nxgt/ai-core` `ModelAdapter`, on Bun `fetch`
with no third-party client. Not published yet. Peer: `@nxgt/ai-core`.

```ts
import { generate } from '@nxgt/ai-core';
import { anthropic } from '@nxgt/ai-anthropic';

const model = anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY!,
	model: 'claude-sonnet-4-5',
});

const { message, usage } = await generate(model, {
	system: [{ text: 'Answer in one sentence.' }],
	messages: [{ role: 'user', parts: [{ type: 'text', text: 'What is Bun?' }] }],
	maxTokens: 200,
});
```

Failures are `AnthropicError`s (an `AiError`): `error.kind` tells an expired
key from an overloaded API. 429, 529, 5xx and network failures are retried
twice, honouring `retry-after`.

Streaming, thinking, prompt caching and `countTokens` arrive in the next slice;
until then a call is one non-streamed request.

## Install

```sh
bun add @nxgt/ai-anthropic @nxgt/ai-core
```

Requires `"moduleResolution": "bundler"`. See the [guide](docs/guide/anthropic.md).
