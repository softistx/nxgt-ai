# Roadmap

A direction, not a commitment. See the [repository roadmap](../../../docs/roadmap.md) for the whole SDK.

## Now

- **`@nxgt/ai-telemetry` 0.1.0** — see an agent run in your traces:
  - `aiTelemetry()`, an `AgentObserver` that writes `@nxgt/telemetry` spans: `ai.agent.run`, `ai.model.call` and `ai.tool.call`, with `gen_ai.*` attributes.
  - Spans keyed by run id, so one observer serves concurrent runs.
  - An abort recorded as cancelled.
  - Prompts and tool content recorded only with `recordContent`.

## Next

- **Token usage as metrics** — counters beside the spans.

## Later

- **Spans for proposed actions** — when one is confirmed or rejected.

## Not planned

- **Recording content by default** — prompts and tool results can hold personal data, so it stays opt-in.

## Shipped

Nothing yet. Releases are listed in `CHANGELOG.md`.
