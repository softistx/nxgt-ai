import type { Message } from '@nxgt/ai-core';
import type { Page } from './types';

export const text = (t: string, role: Message['role'] = 'user'): Message => ({
	role,
	parts: [{ type: 'text', text: t }],
});

export const page = (cursor?: string): Page => ({
	limit: 2,
	...(cursor === undefined ? {} : { cursor }),
});

export const proposal = (id: string): Message => ({
	role: 'assistant',
	parts: [
		{
			type: 'proposed-action',
			id,
			tool: 'archive',
			input: {},
			expiresAt: 9e15,
		},
	],
});
