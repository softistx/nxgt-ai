# @nxgt/ai-telemetry

## 0.2.0

### Minor Changes

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - The `ai.tool.call` span of a proposed action (a `confirm` tool the loop did not run) carries `ai.tool.proposed: true` and stays `ok`; a normal tool's span has no such attribute. The README, the guide and the status table document it, and that an aborted tool shows `cancelled` with `ai.error.code` `ABORTED`.

### Patch Changes

- Updated dependencies [[`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc)]:
  - @nxgt/ai-core@0.2.0

## 0.1.0

### Minor Changes

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `aiTelemetry()`, an `AgentObserver` that writes a run as `@nxgt/telemetry` spans (`ai.agent.run`, `ai.model.call`, `ai.tool.call`) with `gen_ai.*` attributes, an abort recorded as cancelled, and prompts and tool content recorded only with `recordContent`.

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Key `aiTelemetry` spans by run id so one observer, built once, serves concurrent runs.

### Patch Changes

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Deep-review fixes before the first publish: tool calls on a step that ends `max-tokens`, `end` or `refusal` get error results so the next Anthropic turn is valid; a tool input cut by `max_tokens` ends the call `max-tokens` instead of `MODEL_ERROR`; `Usage.inputTokens` counts cached tokens too; `ProposedActionPart.expiresAt` is required; `'proposed'` leaves `RunEndReason`; `AI_ERROR_CODES` is exported and the event schema accepts unknown codes; `start` on text and thinking deltas keeps consecutive blocks apart; `parseRetryAfter` is no longer exported; the retry wait removes its abort listener; `WireErrorCode` and `WireRunEndReason` type event error codes and `done.reason` open (a newer server's value parses) while `AiError.code` stays strict.
- Updated dependencies [[`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983)]:
  - @nxgt/ai-core@0.1.0
