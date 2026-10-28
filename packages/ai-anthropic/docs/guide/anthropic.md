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

| Core                            | Anthropic                                                               |
| ------------------------------- | ----------------------------------------------------------------------- |
| `system` blocks                 | `system: [{ type: 'text', text }]`                                      |
| `maxTokens`                     | `max_tokens`, `4096` when absent (the API requires one)                 |
| `temperature`                   | `temperature`                                                           |
| tool specs                      | `tools: [{ name, description, input_schema }]` (the core's JSON Schema) |
| `text`, `tool-call` parts       | `text`, `tool_use` blocks                                               |
| `thinking` part                 | `thinking` block with its signature; dropped when it has none           |
| `thinking` part with `redacted` | `redacted_thinking` block with its `data`                               |
| `tool-result` part              | `tool_result` block (`is_error: true` on failure), in a user message    |
| `proposed-action` part          | not sent: it is for the user, not the model                             |
| `providerOptions`               | merged into the body last, so it can override any field (see below)     |

A `providerOptions.thinking` that is not `{ type: 'disabled' }` replaces the
typed thinking and is treated like it: `temperature` is dropped, a
`budget_tokens` below 1024 is raised to 1024, and `max_tokens` is recomputed
for the budget (the asked `maxTokens`, or the default plus the budget, and
always above the budget). A type with no budget (such as `adaptive`) only drops
`temperature`. A `temperature` or `max_tokens` named in `providerOptions` is
sent as is.

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
	fetch: async () =>
		new Response(sseText, { headers: { 'content-type': 'text/event-stream' } }),
	sleep: async () => {},
});
```

For a stream, answer with a `text/event-stream` `Response`. For a scripted model with no HTTP at all, use `fakeModel` from
`@nxgt/ai-testing`.

## Streaming

Every call sends `stream: true` and reads the Server-Sent Events as they
arrive. The parser accepts chunks cut anywhere (inside a line, a `\r\n` or a
UTF-8 character) and maps the events to the port's `ModelEvent`s:

| SSE                                           | `ModelEvent`                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `text_delta`                                  | `text-delta`                                                                             |
| `thinking_delta`                              | `thinking-delta`                                                                         |
| `content_block_start` of text or thinking     | `start: true` on the block's first delta                                                 |
| `signature_delta`                             | `thinking-delta` with `text: ''` and `signature`                                         |
| `redacted_thinking` block                     | `thinking-delta` with `text: ''` and `redacted`                                          |
| `input_json_delta`, then `content_block_stop` | one `tool-call` with the assembled, parsed input; a block cut by `max_tokens` is dropped |
| `message_start` + `message_delta` usage       | one `usage`, just before `finish`                                                        |
| `message_stop`                                | `finish`                                                                                 |
| `ping`, server-tool blocks, unknown events    | skipped                                                                                  |

An `error` event throws an `AnthropicError` (`overloaded_error` is
`overloaded`, `rate_limit_error` is `rate-limited`, `authentication_error` and
`permission_error` are `auth`, `invalid_request_error` is `bad-request`,
anything else `provider`). A connection cut before `message_stop` throws a
`network` error. Retries apply only before the first byte: once the response
started, text may already have reached the user, so the error is thrown and
the caller decides.

A gateway that ignores `stream: true` and answers `application/json` is
still understood; any other content type (or none) is read as SSE.

## Thinking

`thinking: { budgetTokens }` sends `thinking: { type: 'enabled', budget_tokens }`.
The budget is at least 1024 (the API's minimum) and defaults to it. With
thinking on, `temperature` is not sent (the API refuses it) and an absent
`maxTokens` becomes `4096 + budget`; an explicit `maxTokens` not above the budget is raised to `budget + 1`, since `max_tokens` must exceed the budget.

The model's thinking arrives as `thinking-delta` events; `generate` folds them
into a `thinking` part that keeps its `signature`. Put that assistant message
back in `messages` on the next turn and the part is sent as it came: the API
needs the signed thinking block in front of a tool result. A thinking part
without a signature is dropped. A `redacted_thinking` block (the API encrypts that reasoning) arrives as a `thinking-delta` with an empty `text` and `redacted` set to the block's `data`; `generate` keeps it as its own `thinking` part and the adapter sends it back as a `redacted_thinking` block, unchanged. Do not read, edit or drop it: the API refuses a tool-use continuation that lacks it. Non-streamed responses map the same way. A `thinking-delta` may carry only a `signature` (empty `text`); a UI must not render it as new text.

## Prompt cache

`cache` defaults to `'auto'`: the adapter adds `cache_control: { type:
'ephemeral' }` to the last tool, the last system block and the last block of
the last user (or tool result) message. That is three of the four breakpoints
the API allows; the fourth stays free. Each call then reads the
prefix the previous call wrote. `cache: 'off'` sends none. Prompts below the
model's minimum cacheable length are simply not cached by the API.

`usage.cacheWriteTokens` and `usage.cacheReadTokens` report what was written
and read; `inputTokens` includes both (it is all the input of the call).

## Counting tokens

`model.countTokens(req, signal?)` calls `POST /v1/messages/count_tokens` with
the same system, tools, messages and thinking as a call (not `max_tokens` or
`temperature`) and returns `input_tokens`. It shares the retries and the error
mapping; an aborted signal rejects with `ABORTED`.

```ts
const tokens = await model.countTokens?.({ system, messages, tools });
```

## Stop reasons

| `stop_reason`                                 | `finish.reason` |
| --------------------------------------------- | --------------- |
| `end_turn`, `stop_sequence`                   | `end`           |
| `tool_use`                                    | `tool-use`      |
| `max_tokens`, `model_context_window_exceeded` | `max-tokens`    |
| `refusal`                                     | `refusal`       |
| `pause_turn`                                  | `end`           |

`pause_turn` means a server-side tool loop paused; the port has no word for
it, so it is `end`. To continue, send the assistant message back as the last
message and call again.

## Smoke test

`bun run smoke:anthropic` (from the repository root) streams a short answer,
runs a thinking and tool-call round trip against the real API, and counts
tokens. It needs `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`), costs
a few cents, and never runs in CI.

## Usage

`inputTokens` is all the input of the call: the API's `input_tokens`, which
excludes the prompt cache, plus `cache_read_input_tokens` and
`cache_creation_input_tokens`. `cacheReadTokens` and `cacheWriteTokens` say how
many of them were cached, so do not add them again. A `maxInputTokens` or
`maxTotalTokens` budget counts the same way. The `message_delta` usage is
cumulative and replaces the `message_start` counts it repeats, before the sum.
