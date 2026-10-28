---
'@nxgt/ai-memory': minor
---

`updateAction(id, ownerId, patch, { from })` takes the status, or list of statuses, the action must have (default `pending`), so an action can be claimed (`pending` to `running`) and its outcome recorded (`running` to `confirmed` or `failed`, with the tool `result`). An illegal transition throws `MemoryError('INVALID_ACTION_TRANSITION')`. A stored failed `result` keeps its error code only: the message is stored empty and the issues are dropped. The in-process, Mongo and Redis stores and `memoryStoreContract` implement it.
