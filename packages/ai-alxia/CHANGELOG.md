# @nxgt/ai-alxia

## 0.1.2

### Patch Changes

- [#100](https://github.com/softistx/nxgt-ai/pull/100) [`c7676b5`](https://github.com/softistx/nxgt-ai/commit/c7676b58a2141d589a2c8b594a364d6cd948fdf1) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Accept `@alxia/core` 0.17: the peer range is now `>=0.16.0 <0.18.0`.

## 0.1.1

### Patch Changes

- Updated dependencies [[`62fac94`](https://github.com/softistx/nxgt-ai/commit/62fac94e52e4cc8a4c5dd5379b2968b5af3ff611)]:
  - @nxgt/ai-core@0.3.0

## 0.1.0

### Minor Changes

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `aiRequest({ observers? })`, an alxia middleware that puts `ctx.ai = { signal, language, observers }` on the request to spread into `runAgent`, and `agentEvents(run, { signal?, heartbeatMs? })` with `agentEventStream`, which stream a run's events as named Server-Sent Events through alxia's `eventStream`. Errors reach the client as codes only, and a disconnect aborts the run.

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `userMessageSchema` (and the `UserMessage` type): the zod shape of a user message in a request body, `role: 'user'` and text parts only, so a forged `proposed-action` part never reaches a memory store. The README and guide gain the trap.

### Patch Changes

- Updated dependencies [[`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc)]:
  - @nxgt/ai-core@0.2.0
