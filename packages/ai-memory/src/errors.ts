/** Every code a memory store raises; later slices may add codes. */
export const MEMORY_ERROR_CODES = [
	'THREAD_NOT_FOUND',
	'MESSAGE_NOT_FOUND',
	'INVALID_CURSOR',
	'INVALID_OWNER',
	'EMPTY_SUMMARY',
	'INVALID_SCOPE',
] as const;

/** Adding a code is not a breaking change, so switch with a default branch. */
export type MemoryErrorCode = (typeof MEMORY_ERROR_CODES)[number];

/** The error a `MemoryStore` raises on a write it cannot do. */
export class MemoryError extends Error {
	override name = 'MemoryError';
	readonly code: MemoryErrorCode;

	constructor(code: MemoryErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}
