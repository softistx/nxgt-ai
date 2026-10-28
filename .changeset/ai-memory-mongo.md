---
'@nxgt/ai-memory': minor
---

Add the `@nxgt/ai-memory/mongo` subpath: `mongoMemory({ threads, messages, expireAfterSeconds?, now? })` over a minimal collection interface that a `mongodb` driver collection (6 or later) or a scoped `@nxgt/mongo` collection satisfies, with `threadFields`, `messageFields` and the indexes to create. `deleteThread` deletes the messages first, then the thread. It passes `memoryStoreContract` against a real mongod.
