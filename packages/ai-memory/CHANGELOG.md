# @nxgt/ai-memory

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
