---
'@nxgt/ai-anthropic': minor
'@nxgt/ai-core': minor
---

Add adaptive thinking and effort: `ThinkingOptions` gains `mode: 'adaptive'`, `effort` and `display`, mapped to `thinking: { type: 'adaptive' }` and `output_config.effort` (effort alone sends no `thinking`). Options that contradict each other (adaptive with `budgetTokens`, `display` with effort alone) throw `INVALID_REQUEST`, a new `AiErrorCode`, before the call; what only some models refuse is left to the API's 400, with the known limits in the troubleshooting page.
