import { describe } from 'bun:test';
import { contractActions } from './contract-actions';
import { contractMessages } from './contract-messages';
import { contractOwner } from './contract-owner';
import { contractThreads } from './contract-threads';
import type { MemoryStore } from './types';

/**
 * The behaviour every `MemoryStore` must have. Call it inside a test file with
 * a factory that returns a fresh, empty store each time:
 *
 *     memoryStoreContract(() => myStore());
 */
export function memoryStoreContract(
	make: () => MemoryStore | Promise<MemoryStore>,
): void {
	describe('MemoryStore contract', () => {
		contractOwner(make);
		contractThreads(make);
		contractMessages(make);
		contractActions(make);
	});
}
