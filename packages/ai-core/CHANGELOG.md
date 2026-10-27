# @nxgt/ai-core

## 0.1.0

### Minor Changes

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add messages and parts, usage, `defineTool` and `jsonSchemaTool` with Zod input validation and JSON Schema generation, `executeTool`, and `AiError`.

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add the model port (`ModelAdapter`, `ModelRequest`, `ModelEvent`), `generate` with abort support, and the `AgentEvent` union with `agentEventSchema`.

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add proposed actions: `confirm: true` tools are proposed by `runAgent` instead of run, with `proposalTtlMs` and `now` options, and `ProposedAction`, `toProposedAction`, `runConfirmedAction` and `rejectAction` (`ACTION_EXPIRED`, `ACTION_NOT_PENDING`) run or refuse them later. Add `estimateTokens`.

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add an optional `redacted` field to the `thinking` part and to `thinking-delta` events: a provider's opaque thinking data, kept as its own part by `generate` and to be sent back unchanged.

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `runAgent`: the agent loop with parallel tool calls, `maxSteps`, a token `budget`, abort through the model stream and `ToolContext.signal`, tool errors returned to the model, and `AgentObserver` hooks.

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Give every `AgentObserver` hook a stable `runId`, also on `AgentResult` and on each `step-start` event. `runAgent` takes a `newId` option for tests.

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add the `onModelStart` and `onToolStart` observer hooks, called before each model call and tool call, so an observer can open a span that covers the work.

### Patch Changes

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Deep-review fixes before the first publish: tool calls on a step that ends `max-tokens`, `end` or `refusal` get error results so the next Anthropic turn is valid; a tool input cut by `max_tokens` ends the call `max-tokens` instead of `MODEL_ERROR`; `Usage.inputTokens` counts cached tokens too; `ProposedActionPart.expiresAt` is required; `'proposed'` leaves `RunEndReason`; `AI_ERROR_CODES` is exported and the event schema accepts unknown codes; `start` on text and thinking deltas keeps consecutive blocks apart; `parseRetryAfter` is no longer exported; the retry wait removes its abort listener; `WireErrorCode` and `WireRunEndReason` type event error codes and `done.reason` open (a newer server's value parses) while `AiError.code` stays strict.
