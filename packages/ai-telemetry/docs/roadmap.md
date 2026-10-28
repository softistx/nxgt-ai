# Roadmap

A direction, not a commitment. See the [repository roadmap](../../../docs/roadmap.md) for the whole SDK.

## Now

Nothing in progress.

## Next

- **Token usage as metrics** — counters beside the spans.

## Later

- **Spans for confirmed and rejected actions** — when a proposed action is confirmed or rejected, beyond the marker on its tool span.

## Not planned

- **Recording content by default** — prompts and tool results can hold personal data, so it stays opt-in.

## Shipped

- **`@nxgt/ai-telemetry` 0.2.0** — A tool call that became a proposed action is marked on its `ai.tool.call` span.

- **`@nxgt/ai-telemetry` 0.1.0** — See an agent run in your traces:
  - `aiTelemetry()`, an `AgentObserver` that writes `@nxgt/telemetry` spans: `ai.agent.run`, `ai.model.call` and `ai.tool.call`, with `gen_ai.*` attributes.
  - Spans keyed by run id, so one observer serves concurrent runs.
  - An abort recorded as cancelled.
  - Prompts and tool content recorded only with `recordContent`.

Earlier releases are listed in `CHANGELOG.md`.
