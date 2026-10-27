import { expect, it } from 'bun:test';
import type { Message } from '@nxgt/ai-core';
import { text } from './contract-fixtures';
import type { MemoryStore } from './types';

export function contractMessages(
	make: () => MemoryStore | Promise<MemoryStore>,
): void {
	it('appends messages in order and loads them', async () => {
		const store = await make();
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [text('one'), text('two', 'assistant')]);
		await store.append(t.id, 'a', [text('three')]);
		const loaded = await store.load(t.id, 'a', { sinceSummary: false });
		expect(loaded?.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
		expect(loaded?.messages.map((m) => m.message.parts[0])).toEqual([
			{ type: 'text', text: 'one' },
			{ type: 'text', text: 'two' },
			{ type: 'text', text: 'three' },
		]);
		expect(loaded?.thread.messageCount).toBe(3);
	});

	it('rejects a message that is not valid', async () => {
		const store = await make();
		const t = await store.createThread({ ownerId: 'a' });
		const bad = { role: 'nobody', parts: [] } as unknown as Message;
		await expect(store.append(t.id, 'a', [bad])).rejects.toThrow();
		expect((await store.getThread(t.id, 'a'))?.messageCount).toBe(0);
	});

	it('loads only what follows the summary when asked', async () => {
		const store = await make();
		const t = await store.createThread({ ownerId: 'a' });
		const stored = await store.append(t.id, 'a', [
			text('1'),
			text('2'),
			text('3'),
		]);
		const through = stored[1]?.id ?? '';
		await store.setSummary(t.id, 'a', {
			text: 'sum',
			throughMessageId: through,
			tokens: 7,
		});
		const since = await store.load(t.id, 'a', { sinceSummary: true });
		expect(since?.summary).toMatchObject({
			text: 'sum',
			throughMessageId: through,
			tokens: 7,
		});
		expect(since?.messages.map((m) => m.seq)).toEqual([3]);
		const all = await store.load(t.id, 'a', { sinceSummary: false });
		expect(all?.messages).toHaveLength(3);
		await expect(
			store.setSummary(t.id, 'a', {
				text: 's',
				throughMessageId: 'missing',
				tokens: 1,
			}),
		).rejects.toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
	});
}
