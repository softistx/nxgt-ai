import { describe, expect, it } from 'bun:test';
import type { Message } from '@nxgt/ai-core';
import type { z } from 'zod';
import type { messageSchema } from './schemas';

// Fails the typecheck when the core's `Message` grows a shape the schema
// would refuse or strip. (One way only: zod types an optional field as
// `?: T | undefined`, which exactOptionalPropertyTypes tells apart.)
const accepted: [Message] extends [z.infer<typeof messageSchema>]
	? true
	: false = true;

describe('messageSchema', () => {
	it('matches the core Message type', () => {
		expect(accepted).toBe(true);
	});
});
