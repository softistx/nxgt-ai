---
'@nxgt/ai-anthropic': minor
---

Stream Anthropic responses over SSE (robust to any byte split, `error` events as `AnthropicError`), add extended thinking with signatures kept for later turns, `cache: 'auto'` prompt-cache breakpoints on the tools, system prompt and last user turn, `countTokens` via `/v1/messages/count_tokens`, and map `pause_turn` and `model_context_window_exceeded`. A local `smoke:anthropic` script tries the adapter against the real API.
