---
'@nxgt/ai-core': minor
---

After an abort, the run no longer waits for a tool that ignores its `ToolContext.signal`: the tool answers `ABORTED` at once and the run ends `aborted`; the tool finishes in the background and its late result is dropped. The README Traps, the agent guide and the troubleshooting page document that a tool must honour its signal, and that `AgentRun` is a single-consumer iterator whose early exit does not abort the run (call `run.abort()`).
