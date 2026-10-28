---
'@nxgt/ai-anthropic': minor
'@nxgt/ai-core': minor
---

Add adaptive thinking and effort: `ThinkingOptions` gains `mode: 'adaptive'`, `effort` and `display`, mapped to `thinking: { type: 'adaptive' }` and `output_config.effort`. A combination the API rejects for the model (a budget on Claude 4.7 and later, adaptive before 4.6, an effort the model lacks) throws `INVALID_REQUEST`, a new `AiErrorCode`, before the call.
