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

## Install

```sh
bun add @nxgt/ai-memory @nxgt/ai-core zod
```

Requires `"moduleResolution": "bundler"`. This package is not published yet.
See the [guide](docs/guide/memory.md).

## Documentation

See [docs/](docs/README.md): the guide, troubleshooting and the roadmap.
