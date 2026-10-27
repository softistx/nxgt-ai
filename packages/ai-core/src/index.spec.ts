import { expect, test } from 'bun:test';
import { AI_CORE } from './index';

test('the placeholder entry loads', () => {
	expect(AI_CORE).toBe('ai-core');
});
