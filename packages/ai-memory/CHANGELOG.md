# @nxgt/ai-memory

## 0.4.0

### Minor Changes

- [#103](https://github.com/softistx/nxgt-ai/pull/103) [`dd47345`](https://github.com/softistx/nxgt-ai/commit/dd4734537df298af38c5e1aa4158b60b169e11c0) Thanks [@SteveGT96](https://github.com/SteveGT96)! - A failed action's stored outcome keeps the tool's `error.details` (cleaned: plain codes and scalar params), while the message is still dropped.

### Patch Changes

- Updated dependencies [[`dd47345`](https://github.com/softistx/nxgt-ai/commit/dd4734537df298af38c5e1aa4158b60b169e11c0)]:
  - @nxgt/ai-core@0.4.0

## 0.3.0

### Minor Changes

- [#94](https://github.com/softistx/nxgt-ai/pull/94) [`62fac94`](https://github.com/softistx/nxgt-ai/commit/62fac94e52e4cc8a4c5dd5379b2968b5af3ff611) Thanks [@SteveGT96](https://github.com/SteveGT96)! - `updateAction(id, ownerId, patch, { from })` takes the status, or list of statuses, the action must have (default `pending`), so an action can be claimed (`pending` to `running`) and its outcome recorded (`running` to `confirmed` or `failed`, with the tool `result`). An illegal transition throws `MemoryError('INVALID_ACTION_TRANSITION')`. A stored failed `result` keeps its error code only: the message is stored empty and the issues are dropped. The in-process, Mongo and Redis stores and `memoryStoreContract` implement it.

### Patch Changes

- Updated dependencies [[`62fac94`](https://github.com/softistx/nxgt-ai/commit/62fac94e52e4cc8a4c5dd5379b2968b5af3ff611)]:
  - @nxgt/ai-core@0.3.0

## 0.2.0

### Minor Changes

- [#93](https://github.com/softistx/nxgt-ai/pull/93) [`11574f5`](https://github.com/softistx/nxgt-ai/commit/11574f51b05423b7f3f53eaca5c7ab888ef610cf) Thanks [@SteveGT96](https://github.com/SteveGT96)! - `mongoMemory` takes a `scope` (tenant fields merged into every filter and stamped on every insert, never updated; `INVALID_SCOPE` for a bad one), `scopedThreadIndexes` and `scopedMessageIndexes` lead the indexes with a `prefix`, and the docs no longer say a scoped `@nxgt/mongo` collection fits as is: pass its driver collection (`.raw`) with `scope`.

## 0.1.0

### Minor Changes

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `compact`, which cuts old tool results then folds the oldest messages into a rolling summary without splitting a tool call from its result and keeping the tail on a user turn (it throws `MemoryError` `EMPTY_SUMMARY` on a blank summary), and `summarizeWith(model)`.

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add the `@nxgt/ai-memory/mongo` subpath: `mongoMemory({ threads, messages, expireAfterSeconds?, now? })` over a minimal collection interface that a `mongodb` driver collection (6 or later) or a scoped `@nxgt/mongo` collection satisfies, with `threadFields`, `messageFields` and the indexes to create. `deleteThread` deletes the messages first, then the thread. It passes `memoryStoreContract` against a real mongod.

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add the `MemoryStore` port scoped by owner on every call, `inProcessMemory()` in-process, zod shapes of the thread and message, and `memoryStoreContract` in `@nxgt/ai-memory/testing`.

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add the `@nxgt/ai-memory/redis` subpath: `redisMemory({ client, prefix?, expireAfterSeconds?, now? })` over the client of `@nxgt/redis` (`connectRedis` or `openRedis`). Each append reserves its seq range and writes its messages in one Lua script, `deleteThread` is one script that removes the thread, its messages and its actions, so it never leaves unreachable keys, and a TTL expires a whole thread, actions included, from its last write. It passes `memoryStoreContract` against a real Redis.

### Patch Changes

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Fix the deep-review findings: the Mongo store now expires a thread as one unit (each write moves every message to the thread's `expiresAt`, so a load never starts with an orphan tool result and the summary cut survives), an `append` racing `deleteThread` removes its own batch and throws `THREAD_NOT_FOUND`, and `summarizeWith` frames the transcript as tagged data blocks with error codes instead of error messages.

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Document the trap of appending parts from a client's request body (a forged `proposed-action` becomes an action anyone can confirm): append only the user's text plus `run.result.messages`.
- Updated dependencies [[`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc)]:
  - @nxgt/ai-core@0.2.0
