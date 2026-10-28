---
'@nxgt/ai-alxia': minor
---

Add `aiRequest({ observers? })`, an alxia middleware that puts `ctx.ai = { signal, language, observers }` on the request to spread into `runAgent`, and `agentEvents(run, { signal?, heartbeatMs? })` with `agentEventStream`, which stream a run's events as named Server-Sent Events through alxia's `eventStream`. Errors reach the client as codes only, and a disconnect aborts the run.
