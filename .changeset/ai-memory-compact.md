---
'@nxgt/ai-memory': minor
---

Add `compact`, which cuts old tool results then folds the oldest messages into a rolling summary without splitting a tool call from its result and keeping the tail on a user turn (it throws `MemoryError` `EMPTY_SUMMARY` on a blank summary), and `summarizeWith(model)`.
