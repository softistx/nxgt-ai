# @nxgt/ai-memory

Conversation memory for [`@nxgt/ai-core`](../ai-core) agents: a `MemoryStore`
port scoped by owner on every call, an in-process store, and a contract suite
to test your own stores. Peers: `@nxgt/ai-core`, `zod`.

```ts
import { memoryStore } from '@nxgt/ai-memory';

const store = memoryStore();
const thread = await store.createThread({ ownerId: 'user-1', title: 'Trip' });

await store.append(thread.id, 'user-1', [
	{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
]);

const loaded = await store.load(thread.id, 'user-1', { sinceSummary: true });
// loaded.messages feed runAgent({ messages: loaded.messages.map((m) => m.message) })
```

Another owner's thread is invisible: `getThread` and `load` return
`undefined`, `findAction` and `updateAction` find nothing, and writes raise
`MemoryError('THREAD_NOT_FOUND')`.

`updateAction` is a compare-and-set on `pending`: of two concurrent
confirmations of one proposed action, one gets the action back and the other
gets `undefined`.

## Test your own store

```ts
// my-store.spec.ts
import { memoryStoreContract } from '@nxgt/ai-memory/testing';

memoryStoreContract(() => myStore());
```

The factory returns a fresh, empty store each time. The suite runs under
`bun test`.

## API

| Export                                                                  | What it is                                                                                                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MemoryStore`                                                           | the port: `createThread`, `getThread`, `listThreads`, `append`, `load`, `setSummary`, `findAction`, `updateAction`, `deleteThread`, each with the `ownerId` |
| `memoryStore({ now? })`                                                 | an in-process store; `now` is the clock in epoch ms                                                                                                         |
| `MemoryError`, `MEMORY_ERROR_CODES`                                     | the error of a failed write; `code` is `THREAD_NOT_FOUND`, `MESSAGE_NOT_FOUND`, `INVALID_CURSOR` or `INVALID_OWNER`                                         |
| `messageSchema`, `threadSchema`, `storedMessageSchema`, `summarySchema` | the zod shapes of a message, a thread, a stored message and a summary                                                                                       |
| `memoryStoreContract(make)`                                             | from `@nxgt/ai-memory/testing`: the suite a store must pass, next to `memoryStore`                                                                          |

## Traps

- A foreign owner reads as absent, never as forbidden.
- `updateAction` returns `undefined` when the action is absent, foreign or no longer `pending`.
- The store never checks `expiresAt`; the core checks it when the action is confirmed.
- A cursor is opaque: pass only a `nextCursor` the store gave.
- `load` with `sinceSummary` returns every message when the summary's `throughMessageId` is no longer found.
- `append` strips keys a message part does not declare.

## Install

```sh
bun add @nxgt/ai-memory @nxgt/ai-core zod
```

Requires `"moduleResolution": "bundler"`. This package is not published yet.
See the [guide](docs/guide/memory.md).

## Documentation

See [docs/](docs/README.md): the guide, troubleshooting and the roadmap.
