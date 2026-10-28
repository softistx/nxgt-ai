import { assertUuidCursor, pageLimit } from './paging';
import {
	assertOwner,
	type Ctx,
	evalLua,
	keys,
	ownThread,
	readThreadHash,
} from './redis-ctx';
import { toThread } from './redis-map';
import { CREATE_THREAD, DELETE_THREAD } from './redis-scripts';
import type { CreateThreadInput, Page, Thread, ThreadPage } from './types';

export async function createThread(
	c: Ctx,
	input: CreateThreadInput,
): Promise<Thread> {
	assertOwner(input.ownerId);
	const id = Bun.randomUUIDv7();
	const at = c.now();
	await evalLua(
		c,
		CREATE_THREAD,
		[keys.thread(c, id), keys.owner(c, input.ownerId)],
		[
			id,
			input.ownerId,
			String(at),
			c.expireAt(at),
			...(input.title === undefined ? [] : ['title', input.title]),
			...(input.meta === undefined ? [] : ['meta', JSON.stringify(input.meta)]),
		],
	);
	const hash = await readThreadHash(c, id);
	return toThread(id, hash ?? {});
}

export async function getThread(c: Ctx, id: string, ownerId: string) {
	const hash = await ownThread(c, id, ownerId);
	return hash ? toThread(id, hash) : undefined;
}

/**
 * Newest first, by id. The owner index can name a thread that has expired:
 * it is skipped and removed, and the page is filled from the ones after it.
 */
export async function listThreads(
	c: Ctx,
	ownerId: string,
	page: Page,
): Promise<ThreadPage> {
	assertOwner(ownerId);
	const limit = pageLimit(page);
	assertUuidCursor(page.cursor);
	const items: Thread[] = [];
	let from = page.cursor === undefined ? '+' : `(${page.cursor}`;
	while (items.length <= limit) {
		const ids = (await c.redis.send('ZRANGE', [
			keys.owner(c, ownerId),
			from,
			'-',
			'BYLEX',
			'REV',
			'LIMIT',
			'0',
			String(limit + 1 - items.length),
		])) as string[];
		if (ids.length === 0) break;
		for (const id of ids) {
			const hash = await readThreadHash(c, id);
			if (hash && hash['ownerId'] === ownerId) items.push(toThread(id, hash));
			else await c.redis.send('ZREM', [keys.owner(c, ownerId), id]);
		}
		from = `(${ids[ids.length - 1]}`;
	}
	const shown = items.slice(0, limit);
	const last = shown[shown.length - 1];
	return {
		items: shown,
		...(items.length > limit && last ? { nextCursor: last.id } : {}),
	};
}

/**
 * One script removes the messages, the actions, the thread and its owner
 * index entry, so a crash or a racing `append` never leaves keys nobody can
 * reach: the append finds the thread gone.
 */
export async function deleteThread(c: Ctx, id: string, ownerId: string) {
	assertOwner(ownerId);
	const done = await evalLua(
		c,
		DELETE_THREAD,
		[
			keys.thread(c, id),
			keys.messages(c, id),
			keys.ids(c, id),
			keys.actionIndex(c, id),
			keys.owner(c, ownerId),
		],
		[ownerId, id],
	);
	return done !== null && done !== undefined;
}
