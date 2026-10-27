---
'@nxgt/ai-core': patch
'@nxgt/ai-anthropic': patch
---

Deep-review fixes before the first publish: tool calls on a step that ends `max-tokens`, `end` or `refusal` get error results so the next Anthropic turn is valid; a tool input cut by `max_tokens` ends the call `max-tokens` instead of `MODEL_ERROR`; `Usage.inputTokens` counts cached tokens too; `ProposedActionPart.expiresAt` is required; `'proposed'` leaves `RunEndReason`; `AI_ERROR_CODES` is exported and the event schema accepts unknown codes; `start` on text and thinking deltas keeps consecutive blocks apart; `parseRetryAfter` is no longer exported; the retry wait removes its abort listener.
