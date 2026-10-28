---
'@nxgt/ai-anthropic': minor
---

Add adaptive thinking and effort: `ThinkingOptions` `mode: 'adaptive'` is sent as `thinking: { type: 'adaptive' }`, `effort` as `output_config.effort` (effort alone sends no `thinking`), and `display` is passed through. Options that contradict each other (adaptive with `budgetTokens`, `display` with effort alone) throw `INVALID_REQUEST` before the call; what only some models refuse is left to the API's 400, with the known limits in the troubleshooting page.
