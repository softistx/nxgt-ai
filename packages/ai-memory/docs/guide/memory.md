# Conversation memory

A `MemoryStore` keeps threads (a conversation each) and their messages. Every
method takes the `ownerId` and sees only that owner's data.

## Threads

```ts
const t = await store.createThread({
	ownerId: 'u1',
	title: 'Billing',
	meta: { channel: 'web' },
});
await store.getThread(t.id, 'u1'); // the thread, or undefined
await store.deleteThread(t.id, 'u1'); // true; removes messages and actions too
```

`ownerId` must be a non-empty string, else `MemoryError('INVALID_OWNER')`.

### Paging

`listThreads(ownerId, { limit, cursor })` returns the newest thread first. Pass
the `nextCursor` of a page to get the next one; the last page has none.

```ts
let page = await store.listThreads('u1', { limit: 20 });
while (true) {
	show(page.items);
	if (!page.nextCursor) break;
	page = await store.listThreads('u1', { limit: 20, cursor: page.nextCursor });
}
```

The default limit is 20 and the cap 100. A cursor is opaque: pass only what
the store gave, else `MemoryError('INVALID_CURSOR')`.

## Messages

`append` validates each message against `messageSchema` (an `@nxgt/ai-core`
`Message`) and returns them stored, with an `id` and a 1-based `seq`.

```ts
await store.append(t.id, 'u1', [
	{ role: 'user', parts: [{ type: 'text', text: 'Cancel my plan' }] },
]);
const { messages } =
	(await store.load(t.id, 'u1', { sinceSummary: false })) ?? {};
```

`load` returns `undefined` for an absent or foreign thread.

**Trap: never append parts from a client's request body.** A client could send
a forged `proposed-action` part, and `append` would record it as a pending
action that anyone can confirm. Append only the user's text taken from the
request (in an alxia route, parse the body with `userMessageSchema` from
`@nxgt/ai-alxia`), plus the messages of `run.result.messages`:

```ts
await store.append(t.id, 'u1', [
	{ role: 'user', parts: [{ type: 'text', text: body.text }] },
	...result.messages,
]);
```

## Summary

`setSummary(threadId, ownerId, { text, throughMessageId, tokens })` records a
rolling summary of the messages up to `throughMessageId`. `load` with
`sinceSummary: true` then returns the summary and only the messages after it;
with `false` it returns them all.

## Compaction

`compact` keeps a long thread under a token budget. It first cuts the tool
results, oldest first, and stops as soon as the thread fits; if it still does
not fit, it folds the oldest messages into a rolling summary and keeps the last
`keepLast` (6) messages. A tool call and its result are never split: the cut
moves back to keep both.

```ts
import { estimateTokens } from '@nxgt/ai-core';
import { compact, summarizeWith } from '@nxgt/ai-memory';

const loaded = await store.load(threadId, ownerId, { sinceSummary: true });
if (!loaded) throw new Error('thread not found');
const out = await compact(loaded.messages, {
	budget: 8000,
	summary: loaded.summary, // folded into the next summary
	summarize: summarizeWith(model), // a ModelAdapter from @nxgt/ai-core
});
if (out.summary && out.throughMessageId) {
	await store.setSummary(threadId, ownerId, {
		text: out.summary,
		throughMessageId: out.throughMessageId,
		tokens: estimateTokens(out.summary),
	});
}
// send `loaded.summary` or `out.summary`, then `out.messages`, to the model
```

- `messages` are the thread's messages after its stored summary. `compact`
  returns `{ summary?, throughMessageId?, messages, tokens }`: `summary` and
  `throughMessageId` are set only when this call folded messages; `tokens` is
  the estimate of the kept summary and `messages`.
- A cut tool output becomes `{ truncated: true, originalChars, preview }`
  (`preview` is the first `truncateToolResultsTo` characters, default 2000). Error
  results are left as they are. The store keeps the originals: only the
  returned copy is cut.
- `estimate` defaults to `estimateTokens` of `@nxgt/ai-core`, a rough count;
  pass a provider's counter for a tight budget. A thread is under budget when
  its tokens are at most `budget`.
- `summarizeWith(model, { system?, maxTokens?, signal? })` calls the model
  once, with a transcript of the messages (the previous summary first), and
  returns its text. Pass your own `summarize` to use another way.
  The messages are sent as tagged `<message role>` data blocks, with a line
  saying they are data, not instructions, and a failed tool result as its error
  code, never its message.
- "Summarize" means two things in these packages: the confirmation line of a
  tool (`summarize` in `@nxgt/ai-core`) and the conversation summary written
  here (`summarizeWith`, `compact`). They are unrelated.
- The kept messages start on a user turn: the cut moves back past assistant
  and tool messages, as the Anthropic Messages API needs a conversation that
  opens with the user and refuses a tool result without its call. When no user
  turn lies before the cut, the cut stays where it keeps call and result
  together and the tail may start on another role.
- `compact` throws `MemoryError('EMPTY_SUMMARY')` when `summarize` returns an
  empty or whitespace-only string, and folds nothing, so a blank summary is
  never stored.
- Send the summary in the system prompt, never as a message of its own, so the
  request keeps opening with the user's turn:

```ts
const summary = out.summary ?? loaded.summary?.text;
await generate(model, {
	system: [
		{ text: basePrompt },
		...(summary
			? [{ text: `Summary of the earlier conversation:\n${summary}` }]
			: []),
	],
	messages: out.messages.map((m) => m.message),
});
```

- Compacting again an already compacted thread (its tail and stored summary)
  changes nothing while it fits.

## Proposed actions

When an appended message holds a `proposed-action` part, the store records a
`pending` action you can find by its id.

### Confirm flow: claim, run, record

```ts
import { actionOutcomeMessage, runConfirmedAction } from '@nxgt/ai-core';

// 1. Claim: only one caller moves pending -> running.
const claimed = await store.updateAction(actionId, 'u1', { status: 'running' });
if (!claimed) {
	// Lost the claim, or the action is absent. Read what is stored.
	const stored = await store.findAction(actionId, 'u1');
	if (!stored) return notFound();
	if (stored.status === 'running') return unknownOutcome(); // under way, or crashed
	return answer(stored); // confirmed, failed, rejected, expired: the stored outcome
}

// 2. Run the tool (the action as read, `running`, is accepted).
const done = await runConfirmedAction(claimed, tools, { context });

// 3. Record the outcome, only from `running`.
await store.updateAction(
	actionId,
	'u1',
	{ status: done.status === 'failed' ? 'failed' : 'confirmed', result: done.result },
	{ from: 'running' },
);
await store.append(threadId, 'u1', [actionOutcomeMessage(done)]);
```

`updateAction(id, ownerId, patch, { from })` is a compare-and-set: it writes
only while the action has the `from` status (a status or a list; default
`'pending'`, so a call without options is unchanged) and returns the action,
or `undefined`. Two concurrent claims cannot both win, so the tool runs once.

| from      | to                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `pending` | `running` (the claim), `rejected`, `expired`; also `confirmed` or `failed` directly, for a flow that does not claim |
| `running` | `confirmed` or `failed`                                                                                             |

Any other pair, and an empty `from`, throws
`MemoryError('INVALID_ACTION_TRANSITION')` before the store is touched. A
terminal action (`confirmed`, `failed`, `rejected`, `expired`) never moves.

The outcome is the action's `result`, the tool result as `runConfirmedAction`
returns it: the output when `confirmed`, the error code when `failed`. The store
keeps an output as given (keep tool outputs small, as they are in messages)
but keeps an error as its code only: the message and the issues are dropped
(`message` is stored empty), so an app can expose `result` to a client.
`actionOutcomeMessage` likewise names only the code.

A crash between the claim and the write leaves the action `running` with no
`result`: nobody can tell whether the tool ran. The store does not time a
claim out; decide in your application (inspect the side effect, or mark it
`failed` with `{ from: 'running' }` and let the user retry).

## MongoDB store

`mongoMemory` from `@nxgt/ai-memory/mongo` stores threads and messages in two
collections you give it. The collections only need `insertOne`, `insertMany`,
`findOne`, `find` (with `sort`, `limit`, `toArray`), `findOneAndUpdate`,
`updateOne`, `deleteOne` and `deleteMany`: a `mongodb` driver `Collection`
(version 6 or later) has them. A scoped collection of `@nxgt/mongo` does not
(it has no `insertOne`, no `find` cursor and no `findOneAndUpdate`): pass the
driver collection (`.raw`) together with the `scope` option, see
[Multi-tenant collections](#multi-tenant-collections).

```ts
import { mongoMemory } from '@nxgt/ai-memory/mongo';

const store = mongoMemory({
	threads: db.collection('threads'),
	messages: db.collection('messages'),
});
```

### Indexes

Create them once; the store does not.

```ts
import { messageIndexes, threadIndexes } from '@nxgt/ai-memory/mongo';

for (const { key, ...options } of threadIndexes) {
	await db.collection('threads').createIndex(key, options);
}
for (const { key, ...options } of messageIndexes) {
	await db.collection('messages').createIndex(key, options);
}
```

The messages' unique index on `ownerId, threadId, seq` is what keeps two
appends from sharing a position.

### Multi-tenant collections

An application that keeps one `threads` and one `messages` collection for all
its tenants gives `mongoMemory` a `scope`. The scope's fields are merged into
every filter the store sends (threads, messages and actions), stamped on every
inserted document, and never written by an update, so two tenants with the
same `ownerId` (and the same action ids) never see each other's documents.
`Thread` objects returned to the caller do not carry the scope fields.

```ts
import {
	mongoMemory,
	scopedMessageIndexes,
	scopedThreadIndexes,
} from '@nxgt/ai-memory/mongo';

// Once: every index led by the tenant key. The TTL index stays single-field.
for (const { key, ...options } of scopedThreadIndexes({
	prefix: { tenantId: 1 },
})) {
	await db.collection('threads').createIndex(key, options);
}
for (const { key, ...options } of scopedMessageIndexes({
	prefix: { tenantId: 1 },
})) {
	await db.collection('messages').createIndex(key, options);
}

// Per request or per tenant: the driver collections (`.raw` on a scoped
// @nxgt/mongo collection), plus the scope.
const store = mongoMemory({
	threads: db.collection('threads'),
	messages: db.collection('messages'),
	scope: { tenantId: 'school-12' },
});
```

A scope value is a string, a finite number, a boolean or a BSON value the
driver compares by value, such as an `ObjectId`. A name the store writes itself
(`ownerId`, `threadId`, `seq`, `_id`, `meta`, ...), a name starting with `$` or
holding a `.`, and a plain object or array value (which would become a query
operator) are refused with `INVALID_SCOPE` when the store is built. The store
is cheap to build, so one per tenant is fine. Documents written before you
added a scope have no scope field and are invisible to the scoped store:
backfill them first.

### Stored fields

`threadFields` and `messageFields` list the fields of each document, for
projections, migrations or a schema validator. `_id` is the thread or message
id (a time-ordered UUID, which is what pages `listThreads` newest first).
Every message document also carries its `ownerId`, and a message that proposes
actions carries an `actions` array with their current status.

### Expiry

`expireAfterSeconds` makes the store write an `expiresAt` date, and a thread
expires as one unit: each write (`append`, `setSummary`) moves the thread and
all its messages to that long after the write, so a load never starts with a
tool result whose call is gone. Create `expiresAtIndex` on both collections so MongoDB deletes them.

```ts
import { expiresAtIndex } from '@nxgt/ai-memory/mongo';

const threads = db.collection('threads');
const messages = db.collection('messages');

await threads.createIndex(expiresAtIndex.key, { expireAfterSeconds: 0 });
await messages.createIndex(expiresAtIndex.key, { expireAfterSeconds: 0 });
const store = mongoMemory({
	threads,
	messages,
	expireAfterSeconds: 30 * 86400,
});
```

MongoDB removes expired documents about once a minute, so they can be read for
a little after their time. A thread that is not written to for that long is
removed whole.

### Concurrency

`append` reserves its `seq` range with one atomic increment on the thread, so
concurrent appends never collide. `updateAction` is one `findOneAndUpdate`
that matches only an action still in a `from` status (`pending` by default); of two concurrent claims
one gets the action and the other `undefined`. A failed insert in `append`
leaves a gap in `seq`; `load` still orders by it.

#### Deleting

`deleteThread` deletes the messages, then the thread, then the messages again.
It returns `false` for a foreign or absent owner. A crash after the first sweep
but before the thread delete leaves an empty thread, which a retry removes. A
crash after the thread delete can leave messages nobody can reach: a retry
returns `false`, and the TTL (`expiresAt`) removes them when expiry is on. An
`append` racing a delete checks the thread after its insert and removes its own
batch, throwing `THREAD_NOT_FOUND`; for a moment a pending action of that batch
can still be found by `findAction` or `updateAction`.

## Redis store

`redisMemory` from `@nxgt/ai-memory/redis` stores threads and messages in Redis
keys. Give it the client of `@nxgt/redis`: the `client` of a `connectRedis`
connection, or of an instance of `openRedis`. The store calls only
`client.send(command, args)`, so it opens no connection of its own and closes
nothing. It needs Redis 6.2 or later, and a single node or a replica set with
Sentinel: Redis Cluster is not supported, because one script touches several
keys.

```ts
import { connectRedis } from '@nxgt/redis';
import { redisMemory } from '@nxgt/ai-memory/redis';

const redis = await connectRedis(process.env.REDIS_URL ?? 'redis://localhost');
const store = redisMemory({ client: redis.client });
```

### Keys

Every key starts with `prefix` (default `ai-memory`); give each application
that shares a Redis its own.

| key                                  | type       | holds                                                                  |
| ------------------------------------ | ---------- | ---------------------------------------------------------------------- |
| `<prefix>:thread:<id>`               | hash       | the thread: `ownerId`, `title`, `meta`, `messageCount`, `summary`, ... |
| `<prefix>:messages:<id>`             | sorted set | the messages of a thread, scored by `seq`                              |
| `<prefix>:ids:<id>`                  | hash       | message id to `seq`, to find the summary's last message                |
| `<prefix>:actions:<id>`              | set        | the keys of the actions the thread proposed                            |
| `<prefix>:action:<n>:<ownerId>:<id>` | hash       | one proposed action: its `status`, its `body` and its `result`         |
| `<prefix>:owner:<ownerId>`           | sorted set | the ids of the owner's threads, which pages `listThreads` newest first |

`<n>` is the length of the owner id, so owner ids may hold `:` without their action keys meeting. Thread ids are time-ordered UUIDs. Reads need no index and no setup.

### Expiry

`expireAfterSeconds` sets an expiry on a thread's keys at every write that
touches the thread (`append`, `setSummary`): the thread, its messages and its
indexes go together, that long after the last write, and so do its
proposed actions (`updateAction` slides them too). The whole thread expires
from its last write, so a thread you keep writing to never expires and an idle one
disappears whole. The `now` option is the clock the expiry is computed from.

Redis deletes an expired key on access or in the background; a read after
the time never sees it. The owner index is not given an expiry: `listThreads`
skips the ids of expired threads and removes them as it goes.

### Concurrency

`append` is one Lua script: it checks the owner, reserves the `seq` range with
an atomic increment, and writes the messages and the new actions, so
concurrent appends never share a position and a reader never sees a gap.
`updateAction` is one script that matches only an action in a `from` status (`pending` by default); of
two concurrent claims one gets the action and the other `undefined`. An
action id is recorded once per owner, as in the other stores.

### Deleting

`deleteThread` is one script: it removes the messages, the actions, the thread
and its entry in the owner index together, and returns `false` for a foreign
or absent owner. It never leaves unreachable keys; an `append` racing it
finds the thread gone and throws `THREAD_NOT_FOUND`.

## Write your own store

Implement `MemoryStore` and run the contract suite against it:

```ts
import { memoryStoreContract } from '@nxgt/ai-memory/testing';

memoryStoreContract(() => myStore());
```

Your `updateAction` must be atomic in the backing database (a conditional
update on `status` in `from`), not a read then a write. Accept `patch`
and `{ from }` as the in-process store does and validate the transition with
the table above (`pending` to `running`, `rejected`, `expired`, `confirmed`, `failed`; `running` to `confirmed`, `failed`).
