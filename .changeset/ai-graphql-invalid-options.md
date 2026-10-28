---
'@nxgt/ai-graphql': patch
---

Add the `INVALID_OPTIONS` code to `GraphqlToolsError`, thrown for a bad `forbidFields` entry or `maxResultChars` in place of `INVALID_OPERATION` with an empty `operation`; `operation` is now `undefined` for it.
