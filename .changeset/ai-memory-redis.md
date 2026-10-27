---
'@nxgt/ai-memory': minor
---

Add the `@nxgt/ai-memory/redis` subpath: `redisMemory({ client, prefix?, expireAfterSeconds?, now? })` over the client of `@nxgt/redis` (`connectRedis` or `openRedis`). Each append reserves its seq range and writes its messages in one Lua script, `deleteThread` deletes the messages first, then the thread, and a TTL expires a whole thread together. It passes `memoryStoreContract` against a real Redis.
