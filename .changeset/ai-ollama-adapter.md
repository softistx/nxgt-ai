---
'@nxgt/ai-ollama': minor
---

Add `ollama()`, a `ModelAdapter` for a local Ollama server on Bun `fetch`: `/api/chat` NDJSON streaming (robust to any byte split) with text and thinking deltas, whole tool calls with generated ids, tool results, `done_reason` and token usage, `keepAlive` and `think` options, `OllamaError` classification (server unreachable, model not found, HTTP failures) and abort support. A local `smoke:ollama` script tries it against your server.
