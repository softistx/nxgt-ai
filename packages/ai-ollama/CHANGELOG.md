# @nxgt/ai-ollama

## 0.2.2

### Patch Changes

- Updated dependencies [[`dd47345`](https://github.com/softistx/nxgt-ai/commit/dd4734537df298af38c5e1aa4158b60b169e11c0)]:
  - @nxgt/ai-core@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`62fac94`](https://github.com/softistx/nxgt-ai/commit/62fac94e52e4cc8a4c5dd5379b2968b5af3ff611)]:
  - @nxgt/ai-core@0.3.0

## 0.2.0

### Minor Changes

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - `providerOptions.options` now merges key by key over the mapped `temperature` and `num_predict`, instead of replacing them. New `numCtx` option sets `options.num_ctx`. Documented in the README, the guide and the troubleshooting page.

### Patch Changes

- Updated dependencies [[`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc)]:
  - @nxgt/ai-core@0.2.0

## 0.1.0

### Minor Changes

- [#41](https://github.com/softistx/nxgt-ai/pull/41) [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `ollama()`, a `ModelAdapter` for a local Ollama server on Bun `fetch`: `/api/chat` NDJSON streaming (robust to any byte split) with text and thinking deltas, whole tool calls with generated ids, tool results, `done_reason` and token usage, `keepAlive` and `think` options, `OllamaError` classification (server unreachable, model not found, HTTP failures) and abort support. A local `smoke:ollama` script tries it against your server.

### Patch Changes

- Updated dependencies [[`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983), [`2b697ad`](https://github.com/softistx/nxgt-ai/commit/2b697add8f56c7fadd9d68b49582b6c96d2c2983)]:
  - @nxgt/ai-core@0.1.0
