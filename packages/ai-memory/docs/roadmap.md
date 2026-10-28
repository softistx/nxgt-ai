# Roadmap

A direction, not a commitment. See the [repository roadmap](https://github.com/softistx/nxgt-ai/blob/develop/docs/roadmap.md) for the whole SDK.

## Now

Nothing in progress.

## Next

Nothing yet.

## Later

- **Mongo expiry that only moves forward** — a late write could no longer shorten a thread's expiry ([#71](https://github.com/softistx/nxgt-ai/issues/71)).

## Not planned

- **Searching across threads** — retrieval is out of scope for the SDK.

## Shipped

- **`@nxgt/ai-memory` 0.1.0** — Conversation memory scoped by owner:
  - `MemoryStore` and `inProcessMemory()`: threads, messages, a rolling summary and proposed actions, with `memoryStoreContract` in `@nxgt/ai-memory/testing` to test your own stores.
  - `compact` and `summarizeWith(model)`: old tool results trimmed first, then a rolling summary, never splitting a tool call from its result.
  - `@nxgt/ai-memory/mongo`: `mongoMemory` over two collections, with optional expiry, and a `scope` option plus `scopedThreadIndexes` / `scopedMessageIndexes` for collections shared by several tenants.
  - `@nxgt/ai-memory/redis`: `redisMemory` over the `@nxgt/redis` client, with optional expiry.

Releases are listed in `CHANGELOG.md`.
