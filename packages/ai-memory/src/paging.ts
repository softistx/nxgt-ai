import { MemoryError } from './errors';
import type { Page } from './types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** The id of a thread in the Mongo and Redis stores: a UUID, also their cursor. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The page size, clamped to 1..100 and 20 by default. */
export const pageLimit = (page: Page): number =>
	Math.min(Math.max(page.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

export const invalidCursor = (cursor: string): MemoryError =>
	new MemoryError(
		'INVALID_CURSOR',
		`"${cursor}" is not a cursor this store gave.`,
	);

/** For the stores whose cursor is a thread id: throws on any other string. */
export function assertUuidCursor(cursor: string | undefined): void {
	if (cursor !== undefined && !UUID.test(cursor)) throw invalidCursor(cursor);
}
