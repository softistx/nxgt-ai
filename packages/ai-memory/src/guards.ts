import { MemoryError } from './errors';

/** Every store call names its owner; an empty one is a bug, not a miss. */
export function assertOwner(ownerId: string): void {
	if (typeof ownerId !== 'string' || ownerId === '') {
		throw new MemoryError(
			'INVALID_OWNER',
			'ownerId must be a non-empty string.',
		);
	}
}

export const notFound = (id: string): MemoryError =>
	new MemoryError('THREAD_NOT_FOUND', `Thread "${id}" was not found.`);
