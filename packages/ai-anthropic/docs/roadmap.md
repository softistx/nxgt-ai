# Roadmap

A direction, not a commitment. See the [repository roadmap](../../../docs/roadmap.md) for the whole SDK.

## Now

Nothing in progress.

## Next

- **Configurable retry policy** — set attempts and backoff instead of the defaults.

## Later

- **Image and document input** — once the core message parts can carry them.

## Not planned

- **The official SDK as a dependency** — the adapter stays on `fetch` with no runtime dependency.

## Shipped

- **`@nxgt/ai-anthropic` 0.1.0** — A `ModelAdapter` for the Anthropic Messages API on Bun `fetch`:
  - `anthropic()`: system, messages, tool calls and results, tools and sampling mapped to a request.
  - SSE streaming, robust to any byte split, with `error` events raised as `AnthropicError`.
  - Extended thinking, with signatures and `redacted_thinking` blocks kept and sent back unchanged.
  - `cache: 'auto'` prompt-cache breakpoints, and `countTokens`.
  - HTTP failures classified, retries honouring `retry-after` and the abort signal.
  - Stop reasons `pause_turn` and `model_context_window_exceeded` mapped.

Earlier releases are listed in `CHANGELOG.md`.
