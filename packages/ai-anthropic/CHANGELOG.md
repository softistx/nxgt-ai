# @nxgt/ai-anthropic

## 0.1.0

### Minor Changes

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Keep `redacted_thinking` blocks across turns (streamed and non-streamed) and send them back unchanged, keep non-streamed `thinking` blocks, and split `eventsFromStream` into smaller functions.

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `anthropic()`, a `ModelAdapter` for the Anthropic Messages API on Bun `fetch`: request mapping (system, messages, tool calls and results, tools, sampling), `AnthropicError` classification of HTTP failures, and retries honouring `retry-after` and the abort signal.

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Stream Anthropic responses over SSE (robust to any byte split, `error` events as `AnthropicError`), add extended thinking with signatures kept for later turns, `cache: 'auto'` prompt-cache breakpoints on the tools, system prompt and last user turn, `countTokens` via `/v1/messages/count_tokens`, and map `pause_turn` and `model_context_window_exceeded`. A local `smoke:anthropic` script tries the adapter against the real API.

### Patch Changes

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Deep-review fixes before the first publish: tool calls on a step that ends `max-tokens`, `end` or `refusal` get error results so the next Anthropic turn is valid; a tool input cut by `max_tokens` ends the call `max-tokens` instead of `MODEL_ERROR`; `Usage.inputTokens` counts cached tokens too; `ProposedActionPart.expiresAt` is required; `'proposed'` leaves `RunEndReason`; `AI_ERROR_CODES` is exported and the event schema accepts unknown codes; `start` on text and thinking deltas keeps consecutive blocks apart; `parseRetryAfter` is no longer exported; the retry wait removes its abort listener; `WireErrorCode` and `WireRunEndReason` type event error codes and `done.reason` open (a newer server's value parses) while `AiError.code` stays strict.
- Updated dependencies [[`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983)]:
  - @nxgt/ai-core@0.1.0
