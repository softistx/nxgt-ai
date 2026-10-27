# Roadmap

A direction, not a commitment. See the [repository roadmap](../../../docs/roadmap.md) for the whole SDK.

## Now

- **`@nxgt/ai-testing` 0.1.0** — test agents without a network:
  - `fakeModel`: a scripted `ModelAdapter` (an array of turns, or a function), with text, thinking, tool calls, usage and finish reason per turn, deterministic `chunk` splitting, `delayMs`, and every request recorded in `requests`.
  - Injected errors: a turn can throw an `AiError` to test failure paths.
  - `collect`: drain a run's events into an array.
  - Tool-call assertions on a list of events.

## Next

- **A clearer message when the script runs out** — name the call count and the last turn played.
- **Scripted tool-call ids you can set** — today ids are `call_<turn>_<index>`.

## Later

- **A helper to replay recorded provider streams** — to test an adapter against real captures.

## Not planned

- **Mocking the network** — use a fake `fetch` in the adapter's own tests; this package replaces the model, not the transport.

## Shipped

Nothing yet. Releases are listed in `CHANGELOG.md`.
