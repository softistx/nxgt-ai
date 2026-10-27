# Roadmap

A direction, not a commitment. See the [repository roadmap](../../../docs/roadmap.md) for the whole SDK.

## Now

- **`@nxgt/ai-ollama` 0.1.0** — a `ModelAdapter` for a local Ollama server on Bun `fetch`:
  - `ollama()` over `/api/chat` NDJSON streaming, robust to any byte split, with text and thinking deltas.
  - Whole tool calls with generated ids, and tool results sent back.
  - `done_reason` and token usage mapped; `keepAlive` and `think` options.
  - `OllamaError` classification: server unreachable, model not found, HTTP failures; abort support.

## Next

- **Sampling options** — pass temperature and other model options through.

## Later

- **Optional retries** — off by default, for a server that is still loading a model.

## Not planned

- **Retries by default** — a local server that refuses a connection will not answer on a second try.
- **Pulling or managing models** — the adapter talks to a server you already run.

## Shipped

Nothing yet. Releases are listed in `CHANGELOG.md`.
