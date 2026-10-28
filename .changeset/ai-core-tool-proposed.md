---
'@nxgt/ai-core': minor
---

`AgentObserver.onToolCall` now receives `proposed: boolean`, true when the call was recorded as a pending proposed action (a `confirm` tool) and the tool did not run. Additive; documented in the agent guide.
