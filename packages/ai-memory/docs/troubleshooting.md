# Troubleshooting

- [`MemoryError` THREAD_NOT_FOUND](#memoryerror-thread_not_found)
- [`MemoryError` MESSAGE_NOT_FOUND](#memoryerror-message_not_found)
- [`MemoryError` INVALID_CURSOR](#memoryerror-invalid_cursor)
- [`MemoryError` INVALID_OWNER](#memoryerror-invalid_owner)
- [`updateAction` returns undefined](#updateaction-returns-undefined)

## `MemoryError` THREAD_NOT_FOUND

**When:** `append` or `setSummary` throws `Thread "…" was not found.`
**Why:** the thread does not exist, was deleted, or belongs to another owner; the store does not tell these apart.
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

## `updateAction` returns undefined

**When:** you confirm an action and get `undefined`.
**Why:** the action is absent, belongs to another owner, or is no longer `pending` because a concurrent call or an earlier one already settled it.
**Fix:** treat it as "not yours to run": do not execute the tool. Call `findAction` to see the status.
