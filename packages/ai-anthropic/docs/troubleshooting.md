# Troubleshooting

Every failure is an `AnthropicError`, an `AiError` with a `kind`, a `status`, a
`requestId` and `retryAfterMs` when the API sent them. `error.retryable` is
true for `rate-limited`, `overloaded`, `provider` and `network`. 429, 529, 5xx
and network failures are retried `maxRetries` times (default 2) before they
reach you.

- [Authentication and requests](#authentication-and-requests): `Anthropic API 401`, `Anthropic API 400`
- [Thinking options](#thinking-options): `Anthropic thinking: ...`
- [Capacity](#capacity): `Anthropic API 429`, `Anthropic API 529`, `Anthropic API 500`
- [Network and stream](#network-and-stream): `Anthropic request failed`, `Anthropic stream ended before message_stop`, stream errors
- [Malformed responses](#malformed-responses)

## Authentication and requests

### `Anthropic API 401: ...` (also 403)

**When:** the first call. `kind: 'auth'`, code `AUTHENTICATION`.
**Why:** the key is missing, wrong, revoked, or has no access to the model.
**Fix:**

```ts
import { anthropic } from '@nxgt/ai-anthropic';

const model = anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY ?? '',
	model: 'claude-sonnet-4-5',
});
```

Fail at startup when the variable is empty. Not retried.

### `Anthropic API 400: ...` (also 404, 413, other 4xx)

**When:** a call with a bad request. `kind: 'bad-request'`, code `MODEL_ERROR`.
**Why:** the API message says what: an unknown model id, `max_tokens` too high, an empty message, a request that is too large. The API text follows the status.
**Fix:** read the text after the status and correct the request.

```ts
anthropic({ apiKey, model: 'claude-sonnet-4-5' }); // check the model id spelling
```

Not retried.

## Thinking options

### `Anthropic thinking: <model> rejects budgetTokens; ...` (also adaptive, effort, display)

**When:** `thinking` asks for something the model's API refuses. Thrown by the adapter before any call, as an `AiError` with code `INVALID_REQUEST` (not an `AnthropicError`, not retried).
**Why:** Claude Fable 5, Sonnet 5 / 5.5, Opus 5 / 5.5 / 4.7 / 4.8 and Haiku 5.5 take no `budget_tokens`; models before Claude 4.6 have no adaptive thinking; Haiku 4.5 and Sonnet 4.5 have no `effort`; `xhigh` and `max` are not on every model; `display` needs a thinking mode.
**Fix:** use the form the model takes.

```ts
thinking: { mode: 'adaptive', effort: 'high' }; // Claude 4.6+ and the 5 family
thinking: { budgetTokens: 2048 }; // Haiku 4.5, Sonnet 4.5, Opus 4.5
```

### Thinking blocks arrive with an empty text

**When:** adaptive thinking on the newest models.
**Why:** `display` defaults to `'omitted'`; the block still carries its `signature`.
**Fix:** `thinking: { mode: 'adaptive', display: 'summarized' }` to read a summary. Keep the block in `messages` either way.

## Capacity

### `Anthropic API 429: ...`

**When:** under load or above your rate limit. `kind: 'rate-limited'`, code `RATE_LIMITED`.
**Why:** too many requests or tokens per minute. `retryAfterMs` holds the `retry-after` header.
**Fix:** retries honour `retry-after`; raise them or slow the caller.

```ts
anthropic({ apiKey, model, maxRetries: 5 });
// or after the error: await sleep(error.retryAfterMs ?? 1000)
```

### `Anthropic API 529: ...`

**When:** the API is overloaded. `kind: 'overloaded'`, code `MODEL_ERROR`.
**Why:** a provider-side capacity problem, not your key.
**Fix:** the same retries apply; try again later or raise `maxRetries`.

### `Anthropic API 500: ...` (any 5xx)

**When:** a provider failure. `kind: 'provider'`, code `MODEL_ERROR`.
**Why:** the API failed. Quote `error.requestId` if you contact support.
**Fix:** retried automatically; if it persists, check the provider's status page.

## Network and stream

### `Anthropic request failed: <reason>`

**When:** `fetch` rejects before a response (DNS, connection refused, TLS, proxy). `kind: 'network'`, code `MODEL_ERROR`.
**Why:** the API, or your `baseUrl` gateway, is not reachable.
**Fix:**

```ts
anthropic({ apiKey, model, baseUrl: 'https://gateway.example.com' }); // no trailing path; /v1/messages is added
```

### `Anthropic stream ended before message_stop`

**When:** mid-answer. `kind: 'network'`.
**Why:** the connection dropped, or a proxy buffered and cut the stream.
**Fix:** retry the call; make sure a proxy in front of the API does not time out long streams.

### `Anthropic stream failed: <reason>`

**When:** the body fails while being read. `kind: 'network'`.
**Why:** the connection broke during the stream.
**Fix:** retry the call.

### `Anthropic stream error (overloaded_error): ...`

**When:** the API sends an `error` event inside a stream that started fine. The text in parentheses is the wire type: `authentication_error`, `permission_error`, `rate_limit_error`, `overloaded_error`, `api_error`, `invalid_request_error`.
**Why:** the failure happened after the HTTP 200. Retries do not apply to it.
**Fix:** handle it like the matching status: use `error.kind`.

```ts
if (error instanceof AnthropicError && error.retryable) retryTheRun();
```

## Malformed responses

All have `kind: 'provider'` and code `MODEL_ERROR`. Usually a gateway or proxy in front of the API rewrote the response; otherwise report it with the `requestId`.

### `Anthropic API returned no body`

**When:** a 200 response with an empty body.
**Why:** a gateway dropped it.
**Fix:** call the API directly to compare.

### `Anthropic API returned a body that is not JSON`

**When:** a gateway ignores `stream: true` and answers with something other than JSON.
**Why:** the gateway is not Anthropic-compatible.
**Fix:** use a compatible `baseUrl`.

### `Anthropic stream sent invalid JSON in a <event> event`

**When:** mid-stream.
**Why:** a proxy corrupted an event, or the stream was truncated.
**Fix:** retry; check the proxy.

### `Anthropic streamed invalid JSON input for tool <name>`

**When:** the model's tool call arguments do not parse and the response did not stop on `max_tokens`.
**Why:** the streamed arguments were corrupt. An input cut off by `max_tokens` (or `model_context_window_exceeded`) is not an error: the adapter drops that tool block and the call finishes `max-tokens`, which `runAgent` ends as `reason: 'max-tokens'`.
**Fix:** if the run ended `max-tokens`, raise `maxTokens` in the request or simplify the tool's input; otherwise retry.

### `Anthropic count_tokens returned a body that is not JSON` / `Anthropic count_tokens returned no input_tokens`

**When:** calling `countTokens`.
**Why:** the endpoint answered something unexpected; many gateways do not implement `/count_tokens`.
**Fix:** use `estimateTokens` from `@nxgt/ai-core` when the gateway lacks the endpoint.

```ts
import { estimateTokens } from '@nxgt/ai-core';
```
