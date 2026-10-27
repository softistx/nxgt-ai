import { dropActions } from './actions';
import { MemoryError } from './errors';
import { assertOwner, own, type State } from './state';
import type { CreateThreadInput, Page, Thread, ThreadPage } from './types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseCursor(cursor: string): number {
	const order = /^\d+$/.test(cursor) ? Number(cursor) : Number.NaN;
	if (!Number.isSafeInteger(order)) {
		throw new MemoryError(
			'INVALID_CURSOR',
			`"${cursor}" is not a cursor this store gave.`,
		);
	}
	return order;
}

export function createThread(s: State, input: CreateThreadInput): Thread {
	assertOwner(input.ownerId);
	const at = s.now();
	const thread: Thread = {
		id: crypto.randomUUID(),
		ownerId: input.ownerId,
		...(input.title === undefined ? {} : { title: input.title }),
		...(input.meta === undefined ? {} : { meta: structuredClone(input.meta) }),
		messageCount: 0,
		createdAt: at,
		updatedAt: at,
	};
	s.threads.set(thread.id, { thread, order: ++s.counter, messages: [] });
	return structuredClone(thread);
}

export function getThread(s: State, id: string, ownerId: string) {
	const record = own(s, id, ownerId);
	return record && structuredClone(record.thread);
}

export function listThreads(s: State, ownerId: string, page: Page): ThreadPage {
	assertOwner(ownerId);
	const limit = Math.min(Math.max(page.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
	const before =
		page.cursor === undefined ? Infinity : parseCursor(page.cursor);
	const mine = [...s.threads.values()]
		.filter((r) => r.thread.ownerId === ownerId && r.order < before)
		.sort((a, b) => b.order - a.order);
	const items = mine.slice(0, limit);
	const last = items[items.length - 1];
	return {
		items: items.map((r) => structuredClone(r.thread)),
		...(mine.length > limit && last ? { nextCursor: String(last.order) } : {}),
	};
}

export function deleteThread(s: State, id: string, ownerId: string): boolean {
	if (!own(s, id, ownerId)) return false;
	s.threads.delete(id);
	dropActions(s, id);
	return true;
}
