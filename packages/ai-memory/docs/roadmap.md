# Roadmap

A direction, not a commitment. See the [repository roadmap](../../../docs/roadmap.md) for the whole SDK.

## Now

- **The memory port and the in-process store** — you get:
  - `MemoryStore`, scoped by owner on every call: threads, messages, a rolling summary and proposed actions.
  - `memoryStore()`, an in-process store.
  - `memoryStoreContract` in `@nxgt/ai-memory/testing`, to test your own stores.
- **Compaction** — you get:
  - `compact`, which trims old tool results first, then keeps a rolling summary without splitting a tool call from its result.
  - `summarizeWith(model)`, a summarizer over any model adapter.

## Next

- **MongoDB and Redis stores** — `./mongo` and `./redis` subpaths that pass the same contract.

## Later

Nothing yet.

## Not planned

- **Searching across threads** — retrieval is out of scope for the SDK.

## Shipped

Nothing yet. Releases are listed in `CHANGELOG.md`.
