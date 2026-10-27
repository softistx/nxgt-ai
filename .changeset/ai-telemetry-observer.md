---
'@nxgt/ai-telemetry': minor
---

Add `aiTelemetry()`, an `AgentObserver` that writes a run as `@nxgt/telemetry` spans (`ai.agent.run`, `ai.model.call`, `ai.tool.call`) with `gen_ai.*` attributes, an abort recorded as cancelled, and prompts and tool content recorded only with `recordContent`.
