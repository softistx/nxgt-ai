---
'@nxgt/ai-telemetry': minor
---

The `ai.tool.call` span of a proposed action (a `confirm` tool the loop did not run) carries `ai.tool.proposed: true` and stays `ok`; a normal tool's span has no such attribute. The README, the guide and the status table document it, and that an aborted tool shows `cancelled` with `ai.error.code` `ABORTED`.
