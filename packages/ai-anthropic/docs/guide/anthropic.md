# The Anthropic adapter

`anthropic(options)` returns a `ModelAdapter` (`provider: 'anthropic'`) that
calls `POST {baseUrl}/v1/messages` with Bun `fetch`. Pass it to `generate` or
`runAgent` like any other model.

```ts
import { anthropic } from '@nxgt/ai-anthropic';

const model = anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY!,
	model: 'claude-sonnet-4-5',
	maxRetries: 3,
	beta: ['some-beta-2026-01-01'],
});
```

## Options

| Option                   | Default                     | Meaning                                                   |
| ------------------------ | --------------------------- | --------------------------------------------------------- |
| `apiKey`                 | required                    | sent as `x-api-key`                                       |
| `model`                  | required                    | the model id                                              |
| `baseUrl`                | `https://api.anthropic.com` | a proxy or gateway; a trailing slash is ignored           |
| `maxRetries`             | `2`                         | retries after the first attempt; `0` turns them off       |
| `version`                | `2023-06-01`                | the `anthropic-version` header                            |
| `beta`                   | none                        | feature flags, sent comma-joined as `anthropic-beta`      |
| `fetch`                  | global `fetch`              | replace it in tests                                       |
| `sleep`, `now`, `random` | real ones                   | replace the retry wait, the clock and the jitter in tests |

## What is sent

| Core                      | Anthropic                                                               |
| ------------------------- | ----------------------------------------------------------------------- |
| `system` blocks           | `system: [{ type: 'text', text }]`                                      |
| `maxTokens`               | `max_tokens`, `4096` when absent (the API requires one)                 |
| `temperature`             | `temperature`                                                           |
| tool specs                | `tools: [{ name, description, input_schema }]` (the core's JSON Schema) |
| `text`, `tool-call` parts | `text`, `tool_use` blocks                                               |
| `thinking` part           | `thinking` block with its signature; dropped when it has none           |
| `tool-result` part        | `tool_result` block (`is_error: true` on failure), in a user message    |
| `proposed-action` part    | not sent: it is for the user, not the model                             |
| `providerOptions`         | merged into the body last, so it can override any field                 |

Consecutive messages of one role are merged, as the API requires; a `tool`
message becomes a user message. A tool output that is not a string is sent as
JSON; a failed result is sent as the JSON of its `{ code, message, issues }`.

## Errors

Every failure is an `AnthropicError`, an `AiError` with more fields:
`kind`, `status`, `retryAfterMs`, `requestId` (the `request-id` header, worth
quoting in a support ticket) and `retryable`.

| HTTP                     | `kind`         | `AiError.code`   | Retried |
| ------------------------ | -------------- | ---------------- | ------- |
| 401, 403                 | `auth`         | `AUTHENTICATION` | no      |
| 400, 404, 413, other 4xx | `bad-request`  | `MODEL_ERROR`    | no      |
| 429                      | `rate-limited` | `RATE_LIMITED`   | yes     |
| 529                      | `overloaded`   | `MODEL_ERROR`    | yes     |
| other 5xx                | `provider`     | `MODEL_ERROR`    | yes     |
| `fetch` rejected         | `network`      | `MODEL_ERROR`    | yes     |

```ts
import { AnthropicError } from '@nxgt/ai-anthropic';

try {
	await generate(model, req);
} catch (error) {
	if (error instanceof AnthropicError && error.kind === 'rate-limited')
		console.warn(`retry in ${error.retryAfterMs ?? 1000} ms`);
	else throw error;
}
```

## Retries

An attempt that fails with a retryable error waits, then tries again, up to
`maxRetries` times. The wait is the `retry-after` header (seconds or an HTTP
date) when present, else an exponential backoff: 500 ms, 1 s, 2 s, ... capped
at 8 s, jittered between half and the full value. A `retry-after` longer than
60 s is not waited out: the error is thrown with `retryAfterMs` set.

## Abort

When the signal aborts, before the call, during a request or during a retry
wait, the stream ends without an event and without an error, as the model port
asks. `generate` and `runAgent` turn that into `ABORTED`.

## Testing

Inject `fetch` (and `sleep`, so a retry takes no time):

```ts
const model = anthropic({
	apiKey: 'test',
	model: 'claude-test',
	fetch: async () => new Response(JSON.stringify(reply), { status: 200 }),
	sleep: async () => {},
});
```

For a scripted model with no HTTP at all, use `fakeModel` from
`@nxgt/ai-testing`.

## Not yet

Streaming (SSE), thinking requests, prompt-cache breakpoints (`cache`) and
`countTokens` are the next slice. Until then `thinking` and `cache` in a
request are ignored, and `stream` yields the events of one complete response.

## Usage

`inputTokens` is the API's `input_tokens`, which excludes the tokens read from
or written to the prompt cache; those are `cacheReadTokens` and
`cacheWriteTokens`. A `stop_reason` the port has no word for (such as
`pause_turn`) is reported as `end`.
