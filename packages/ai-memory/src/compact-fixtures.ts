import type { Message } from '@nxgt/ai-core';
import {
	type CompactOptions,
	inProcessMemory,
	type StoredMessage,
} from './index';

export const chars = (input: string | readonly Message[]) =>
	typeof input === 'string' ? input.length : JSON.stringify(input).length;

export const say = (i: number, role: Message['role'] = 'user'): Message => ({
	role,
	parts: [{ type: 'text', text: `m${i}` }],
});
export const call = (id: string): Message => ({
	role: 'assistant',
	parts: [{ type: 'tool-call', id, name: 'search', input: {} }],
});
export const result = (id: string, output: unknown): Message => ({
	role: 'tool',
	parts: [
		{ type: 'tool-result', callId: id, name: 'search', isError: false, output },
	],
});

export async function stored(messages: Message[]): Promise<StoredMessage[]> {
	const store = inProcessMemory();
	const t = await store.createThread({ ownerId: 'o' });
	return store.append(t.id, 'o', messages);
}

export const opts = (budget: number, extra: Partial<CompactOptions> = {}) => ({
	budget,
	estimate: chars,
	summarize: async () => 'SUMMARY',
	...extra,
});
