---
'@nxgt/ai-anthropic': minor
---

Add `anthropic()`, a `ModelAdapter` for the Anthropic Messages API on Bun `fetch`: request mapping (system, messages, tool calls and results, tools, sampling), `AnthropicError` classification of HTTP failures, and retries honouring `retry-after` and the abort signal.
