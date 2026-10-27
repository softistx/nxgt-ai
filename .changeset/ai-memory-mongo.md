---
'@nxgt/ai-memory': minor
---

Add the `@nxgt/ai-memory/mongo` subpath: `mongoMemory({ threads, messages, expireAfterSeconds? })` over a minimal collection interface that a `mongodb` driver collection or a scoped `@nxgt/mongo` collection satisfies, with `threadFields`, `messageFields` and the indexes to create. It passes `memoryStoreContract` against a real mongod.
