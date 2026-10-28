# Roadmap

A direction, not a commitment. See the [repository roadmap](https://github.com/softistx/nxgt-ai/blob/develop/docs/roadmap.md) for the whole SDK.

## Now

- **Request middleware and SSE reply** — `aiRequest` and `agentEvents`: you get:
  - `ctx.ai = { signal, language, observers }` to spread into `runAgent`, the signal aborting when the client leaves;
  - a run's events as named Server-Sent Events written by alxia, typed by `agentEventStream`, with an optional heartbeat comment;
  - errors on the wire as codes only, and the run stopped on disconnect.

## Next

Nothing yet.

## Later

- **A client reader** — an async iterable of `AgentEvent` from a `fetch` response, for a browser or another service.

## Not planned

- **Its own SSE writer** — alxia's `eventStream` already frames, validates and keeps alive.
- **WebSocket transport** — SSE is enough for a one-way stream of events.

## Shipped

Nothing yet. Releases are listed in `CHANGELOG.md`.
