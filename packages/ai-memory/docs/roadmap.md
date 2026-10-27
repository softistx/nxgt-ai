# Roadmap

A direction, not a commitment. See the [repository roadmap](../../../docs/roadmap.md) for the whole SDK.

## Now

- **The memory port and the in-process store** — you get:
  - `MemoryStore`, scoped by owner on every call: threads, messages, a rolling summary and proposed actions.
  - `memoryStore()`, an in-process store.
  - `memoryStoreContract` in `@nxgt/ai-memory/testing`, to test your own stores.

## Next

- **MongoDB and Redis stores** — `./mongo` and `./redis` subpaths that pass the same contract.
- **Compaction** — trim old tool results first, then keep a rolling summary without splitting a tool call from its result.

## Later

Nothing yet.

## Not planned

- **Searching across threads** — retrieval is out of scope for the SDK.

## Shipped

Nothing yet. Releases are listed in `CHANGELOG.md`.
