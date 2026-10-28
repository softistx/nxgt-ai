# Troubleshooting

- [`MemoryError` THREAD_NOT_FOUND](#memoryerror-thread_not_found)
- [`MemoryError` MESSAGE_NOT_FOUND](#memoryerror-message_not_found)
- [`MemoryError` INVALID_CURSOR](#memoryerror-invalid_cursor)
- [`MemoryError` INVALID_OWNER](#memoryerror-invalid_owner)
- [`updateAction` returns undefined](#updateaction-returns-undefined)
- [`MemoryError` INVALID_ACTION_TRANSITION](#memoryerror-invalid_action_transition)
- [An action stays `running`](#an-action-stays-running)
- [`compact` returns more tokens than `budget`](#compact-returns-more-tokens-than-budget)
- [The summary forgets what the previous one said](#the-summary-forgets-what-the-previous-one-said)
- [The model sees `{ truncated: true, preview }` as a tool result](#the-model-sees--truncated-true-preview--as-a-tool-result)
- [`MemoryError` INVALID_SCOPE](#memoryerror-invalid_scope)
- [`MemoryError` EMPTY_SUMMARY](#memoryerror-empty_summary)
- [Mongo store: `E11000 duplicate key` on `ownerId_1_threadId_1_seq_1`](#mongo-store-e11000-duplicate-key-on-ownerid_1_threadid_1_seq_1)
- [Mongo store: expired threads and messages are still read](#mongo-store-expired-threads-and-messages-are-still-read)
- [Mongo store: `findOneAndUpdate` returns a result object, not a document](#mongo-store-findoneandupdate-returns-a-result-object-not-a-document)
- [Mongo store: a failed `append` leaves a gap in `seq`](#mongo-store-a-failed-append-leaves-a-gap-in-seq)
- [Redis store: `ERR syntax error` when listing threads](#redis-store-err-syntax-error-when-listing-threads)
- [Redis store: `CROSSSLOT Keys in request don't hash to the same slot`](#redis-store-crossslot-keys-in-request-dont-hash-to-the-same-slot)
- [Redis store: `WRONGTYPE Operation against a key holding the wrong kind of value`](#redis-store-wrongtype-operation-against-a-key-holding-the-wrong-kind-of-value)
- [Redis store: `ERR_REDIS_CONNECTION_CLOSED`](#redis-store-err_redis_connection_closed)
- [Redis store: a thread is gone before its time](#redis-store-a-thread-is-gone-before-its-time)

## `MemoryError` THREAD_NOT_FOUND

**When:** `append` or `setSummary` throws `Thread "…" was not found.`
**Why:** the thread does not exist, was deleted, or belongs to another owner; the store does not tell these apart. A Mongo `append` racing a `deleteThread` also throws it and removes its own batch; this is expected, so do not retry.
**Fix:** check the `ownerId` is the one that created the thread.

```ts
const thread = await store.getThread(id, ownerId);
if (!thread) return notFound();
```

## `MemoryError` MESSAGE_NOT_FOUND

**When:** `setSummary` throws `Message "…" is not in thread "…".`
**Why:** `throughMessageId` is not the `id` of a message of that thread.
**Fix:** use an `id` returned by `append` or `load`, not a `seq`.

## `MemoryError` INVALID_CURSOR

**When:** `listThreads` throws `"…" is not a cursor this store gave.`
**Why:** the cursor was edited, or came from another store.
**Fix:** pass back the `nextCursor` of the previous page unchanged.

## `MemoryError` INVALID_OWNER

**When:** any call throws `ownerId must be a non-empty string.`
**Why:** the owner id is empty or missing, which would put every caller in one scope.
**Fix:** resolve the signed-in user before calling the store.

## `MemoryError` INVALID_SCOPE

**When:** `mongoMemory` throws `Scope field "…" …` while it is built, or `scopedThreadIndexes` / `scopedMessageIndexes` throw `Index prefix field "…" is already a key of the index.`
**Why:** a scope field is named like a field the store writes (`ownerId`, `threadId`, `seq`, `_id`, `meta`, ...), starts with `$`, holds a `.`, or its value is not a string, a finite number, a boolean or a BSON value such as an `ObjectId`.
**Fix:** use a tenant field of your own (`tenantId`) with a primitive or `ObjectId` value:

```ts
mongoMemory({ threads, messages, scope: { tenantId: 'school-12' } });
```

## `updateAction` returns undefined

**When:** you confirm an action and get `undefined`.
**Why:** the action is absent, belongs to another owner, or is not in the `from` status (default `pending`) because a concurrent call or an earlier one already claimed or settled it.
**Fix:** treat it as "not yours to run": do not execute the tool. Call `findAction` to see the status and answer the stored outcome.

## `MemoryError` INVALID_ACTION_TRANSITION

**When:** `updateAction` throws `An action cannot move from running to rejected.` (or an empty `from`).
**Why:** `patch.status` is not reachable from a `from` status. Allowed: `pending` to `running`, `rejected`, `expired` (or `confirmed`/`failed` without a claim); `running` to `confirmed` or `failed`.
**Fix:** claim with `{ status: 'running' }`, then record the outcome with `{ from: 'running' }`.

```ts
await store.updateAction(
	id,
	'u1',
	{ status: 'failed', result },
	{ from: 'running' },
);
```

## An action stays `running`

**When:** `findAction` shows `running` with no `result` long after the claim.
**Why:** the process died between the claim and the outcome write; nobody knows if the tool ran. The store never times a claim out.
**Fix:** check the side effect, then write `failed` or `confirmed` with `{ from: 'running' }`, or let the user retry.

## `compact` returns more tokens than `budget`

It happens when the last `keepLast` messages (default 6), or a tool call and the
result kept with it, are alone over the budget. `compact` never drops them. Lower
`keepLast`, lower `truncateToolResultsTo`, or raise `budget`.

```ts
await compact(messages, {
	budget,
	keepLast: 2,
	truncateToolResultsTo: 500,
	summarize,
});
```

## The summary forgets what the previous one said

`compact` only knows the earlier summary when you give it. Pass the thread's
stored one as `summary`.

```ts
const loaded = await store.load(id, ownerId, { sinceSummary: true });
await compact(loaded.messages, { budget, summary: loaded.summary, summarize });
```

## The model sees `{ truncated: true, preview }` as a tool result

That is a tool output cut by `compact` because it was longer than
`truncateToolResultsTo` characters. The stored message is unchanged. Raise
`truncateToolResultsTo`, or have the tool return less.

## `MemoryError` EMPTY_SUMMARY

`summarize` returned an empty or whitespace-only string, so `compact` folded
nothing rather than let a blank summary replace the messages. Check the model's
reply (a refusal or a `maxTokens` too low gives no text) and retry.

```ts
try {
	await compact(messages, { budget, summarize });
} catch (e) {
	if (e instanceof MemoryError && e.code === 'EMPTY_SUMMARY') retryLater();
	else throw e;
}
```

## Mongo store: `E11000 duplicate key` on `ownerId_1_threadId_1_seq_1`

**When:** `append` on the Mongo store fails with a duplicate key error.
**Why:** two documents got the same `seq` in a thread: the messages were written by something other than the store, or `messageCount` of the thread was changed by hand.
**Fix:** let only the store write these collections. Set the thread's `messageCount` to the highest `seq` of its messages again.

```ts
const last = await messages
	.find({ threadId })
	.sort({ seq: -1 })
	.limit(1)
	.toArray();
await threads.updateOne(
	{ _id: threadId },
	{ $set: { messageCount: last[0]?.seq ?? 0 } },
);
```

## Mongo store: expired threads and messages are still read

**When:** a thread past its `expireAfterSeconds` still loads.
**Why:** MongoDB's TTL monitor runs about once a minute, and it only runs for a collection that has `expiresAtIndex`.
**Fix:** create `expiresAtIndex` on both collections (see the guide), and do not rely on the exact second of expiry.

## Mongo store: `findOneAndUpdate` returns a result object, not a document

**When:** `append` stores `NaN` as a `seq`, or `updateAction` returns `undefined` for a pending action that exists.
**Why:** the collection resolves `findOneAndUpdate` to `{ value }`, as `mongodb` 5 and earlier do; the store needs the document itself.
**Fix:** use `mongodb` 6 or later, or wrap the collection so `findOneAndUpdate` resolves to the document.

## Mongo store: a failed `append` leaves a gap in `seq`

**When:** an `append` threw while inserting, and the next messages start at a higher `seq` than the last stored one.
**Why:** the store reserves the `seq` range on the thread before inserting, so a failed insert keeps `messageCount` advanced.
**Fix:** none needed. A retry of the `append` works, but the gap stays. It is harmless: `load` orders by `seq`.

## Redis store: `ERR syntax error` when listing threads

**When:** `listThreads` fails with `ERR syntax error`.
**Why:** it pages with `ZRANGE ... BYLEX REV`, which Redis 6.2 added; an older server does not know the form.
**Fix:** use Redis 6.2 or later.

## Redis store: `CROSSSLOT Keys in request don't hash to the same slot`

**When:** `append`, `setSummary` or `deleteThread` fails on a Redis Cluster.
**Why:** each script touches the keys of a thread, which a cluster spreads over several slots, and builds the action keys inside the script instead of declaring them in `KEYS`. Redis Cluster is not supported. The store supports a single node, or one primary with replicas behind Sentinel.
**Fix:** point the client at a non-cluster Redis.

## Redis store: `WRONGTYPE Operation against a key holding the wrong kind of value`

**When:** any call fails with `WRONGTYPE`.
**Why:** another application, or a cache, writes keys that start with the same `prefix`.
**Fix:** give the store a prefix of its own, and clear the keys that collide.

```ts
const store = redisMemory({ client, prefix: 'support-chat' });
```

## Redis store: `ERR_REDIS_CONNECTION_CLOSED`

**When:** a call rejects with `ERR_REDIS_CONNECTION_CLOSED`.
**Why:** the client was closed, by `connection.close()` or `closeRedis()` of `@nxgt/redis`, while the store still used it. The store never opens or closes a connection.
**Fix:** close the connection after the last call, at shutdown, and build the store from a connection that is still open.

## Redis store: a thread is gone before its time

**When:** `getThread` returns `undefined` or `append` throws `THREAD_NOT_FOUND` for a thread you created.
**Why:** `expireAfterSeconds` counts from the thread's last write, and the clock the expiry uses is `now`: a `now` that returns a time in the past, or a short TTL, expires the thread at once.
**Fix:** leave `now` out (it is `Date.now`) or give it epoch milliseconds, and set `expireAfterSeconds` longer than the idle time you accept.
