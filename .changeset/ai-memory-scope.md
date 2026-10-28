---
'@nxgt/ai-memory': minor
---

`mongoMemory` takes a `scope` (tenant fields merged into every filter and stamped on every insert, never updated; `INVALID_SCOPE` for a bad one), `scopedThreadIndexes` and `scopedMessageIndexes` lead the indexes with a `prefix`, and the docs no longer say a scoped `@nxgt/mongo` collection fits as is: pass its driver collection (`.raw`) with `scope`.
