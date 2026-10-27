---
'@nxgt/ai-memory': minor
---

Add the `@nxgt/ai-memory/redis` subpath: `redisMemory({ client, prefix?, expireAfterSeconds?, now? })` over the client of `@nxgt/redis` (`connectRedis` or `openRedis`). Each append reserves its seq range and writes its messages in one Lua script, `deleteThread` is one script that removes the thread, its messages and its actions, so it never leaves unreachable keys, and a TTL expires a whole thread, actions included, from its last write. It passes `memoryStoreContract` against a real Redis.
