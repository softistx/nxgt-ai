# @nxgt/ai-core

## 0.4.0

### Minor Changes

- [#103](https://github.com/softistx/nxgt-ai/pull/103) [`dd47345`](https://github.com/softistx/nxgt-ai/commit/dd4734537df298af38c5e1aa4158b60b169e11c0) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `AiError` `details`, `ToolErrorInfo.details`, `ToolErrorDetail` and `cleanErrorDetails`: a tool reports its own error codes as structured data, and `errorResult` carries them.

## 0.3.0

### Minor Changes

- [#94](https://github.com/softistx/nxgt-ai/pull/94) [`62fac94`](https://github.com/softistx/nxgt-ai/commit/62fac94e52e4cc8a4c5dd5379b2968b5af3ff611) Thanks [@SteveGT96](https://github.com/SteveGT96)! - `ProposedActionStatus` gains `running`, the claim of an action before it runs. `runConfirmedAction` accepts a `pending` or `running` action (a claimed action is not checked against its expiry again), and `actionOutcomeMessage` refuses a `running` action like a `pending` one. The guide documents the claim, run, record flow.

## 0.2.0

### Minor Changes

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - After an abort, the run no longer waits for a tool that ignores its `ToolContext.signal`: the tool answers `ABORTED` at once and the run ends `aborted`; the tool finishes in the background and its late result is dropped. The README Traps, the agent guide and the troubleshooting page document that a tool must honour its signal, and that `AgentRun` is a single-consumer iterator whose early exit does not abort the run (call `run.abort()`).

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `summarize(input)` to `defineTool` and `jsonSchemaTool`: a short line for the confirmation UI that fills `ProposedActionPart.summary` (also `ProposedAction.summary`; a throwing `summarize` leaves it out). Add `actionOutcomeMessage(action, { reason? })`, which turns a confirmed, rejected, failed or expired action into a user text message that tells the model the outcome in a later request framed as an application event, with the summary and reason as JSON strings and the tool output in a `<tool-output>` data block, cut without splitting a surrogate (error code only, never error text).

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `mode: 'adaptive'`, `effort` and `display` to `ThinkingOptions`, with the `ThinkingEffort` type, and the `INVALID_REQUEST` `AiErrorCode` for options that contradict each other.

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - `AgentObserver.onToolCall` now receives `proposed: boolean`, true when the call was recorded as a pending proposed action (a `confirm` tool) and the tool did not run. Additive; documented in the agent guide.

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
