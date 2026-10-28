import { expect, it } from 'bun:test';
import { proposal } from './contract-samples';
import type { MemoryStore } from './types';

export function contractActions(
	make: () => MemoryStore | Promise<MemoryStore>,
): void {
	it('finds an action from the proposed-action part', async () => {
		const store = await make();
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [proposal('act-1')]);
		expect(await store.findAction('act-1', 'a')).toMatchObject({
			id: 'act-1',
			tool: 'archive',
			status: 'pending',
		});
		expect(await store.findAction('other', 'a')).toBeUndefined();
	});

	it('lets one of two concurrent confirmations win', async () => {
		const store = await make();
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [proposal('act-1')]);
		const results = await Promise.all([
			store.updateAction('act-1', 'a', { status: 'confirmed' }),
			store.updateAction('act-1', 'a', { status: 'confirmed' }),
		]);
		expect(results.filter(Boolean)).toHaveLength(1);
		expect((await store.findAction('act-1', 'a'))?.status).toBe('confirmed');
		expect(
			await store.updateAction('act-1', 'a', { status: 'rejected' }),
		).toBeUndefined();
	});

	it('removes a thread together with its actions', async () => {
		const store = await make();
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [proposal('act-1')]);
		await store.deleteThread(t.id, 'a');
		expect(await store.findAction('act-1', 'a')).toBeUndefined();
	});

	it('keeps the same action id apart for two owners', async () => {
		const store = await make();
		const a = await store.createThread({ ownerId: 'a' });
		const b = await store.createThread({ ownerId: 'b' });
		await store.append(b.id, 'b', [proposal('act-1')]);
		await store.append(a.id, 'a', [proposal('act-1')]);
		expect((await store.findAction('act-1', 'a'))?.status).toBe('pending');
		await store.updateAction('act-1', 'b', { status: 'rejected' });
		expect((await store.findAction('act-1', 'a'))?.status).toBe('pending');
	});

	it('records the result of a settled action', async () => {
		const store = await make();
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [proposal('act-1')]);
		const result = {
			type: 'tool-result',
			callId: 'c1',
			name: 'archive',
			isError: false,
			output: { ok: true },
		} as const;
		const done = await store.updateAction('act-1', 'a', {
			status: 'confirmed',
			result,
		});
		expect(done?.result).toEqual(result);
	});

	const ok = {
		type: 'tool-result',
		callId: 'c1',
		name: 'archive',
		isError: false,
		output: { ok: true },
	} as const;
	const bad = {
		type: 'tool-result',
		callId: 'c1',
		name: 'archive',
		isError: true,
		error: {
			code: 'TOOL_FAILED',
			message: 'boom',
			issues: [{ path: 'x', message: 'boom issue' }],
		},
	} as const;

	const badWithDetails = {
		...bad,
		error: {
			...bad.error,
			details: [
				{
					code: 'auth.errors.forbidden',
					fields: ['id'],
					params: { n: 2 },
					message: 'leaked',
				},
			],
		},
	};

	const seeded = async () => {
		const store = await make();
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [proposal('act-1')]);
		return store;
	};

	it('claims a pending action, then records the run as confirmed', async () => {
		const store = await seeded();
		const claimed = await store.updateAction('act-1', 'a', {
			status: 'running',
		});
		expect(claimed?.status).toBe('running');
		const done = await store.updateAction(
			'act-1',
			'a',
			{ status: 'confirmed', result: ok },
			{ from: 'running' },
		);
		expect(done).toMatchObject({ status: 'confirmed', result: ok });
		expect(await store.findAction('act-1', 'a')).toMatchObject({
			status: 'confirmed',
			result: ok,
		});
	});

	it('records a failed run with its error code', async () => {
		const store = await seeded();
		await store.updateAction('act-1', 'a', { status: 'running' });
		await store.updateAction(
			'act-1',
			'a',
			{ status: 'failed', result: bad },
			{ from: 'running' },
		);
		const stored = await store.findAction('act-1', 'a');
		expect(stored?.status).toBe('failed');
		// the code is kept, the message and the issues are not
		expect(stored?.result).toMatchObject({
			isError: true,
			error: { code: 'TOOL_FAILED' },
		});
		expect(JSON.stringify(stored)).not.toContain('boom');
	});

	it("keeps the tool's error details of a failed run, cleaned", async () => {
		const store = await seeded();
		await store.updateAction('act-1', 'a', { status: 'running' });
		await store.updateAction(
			'act-1',
			'a',
			{ status: 'failed', result: badWithDetails },
			{ from: 'running' },
		);
		const stored = await store.findAction('act-1', 'a');
		expect(stored?.result).toMatchObject({
			isError: true,
			error: {
				code: 'TOOL_FAILED',
				message: '',
				details: [
					{ code: 'auth.errors.forbidden', fields: ['id'], params: { n: 2 } },
				],
			},
		});
		expect(JSON.stringify(stored)).not.toContain('leaked');
		expect(JSON.stringify(stored)).not.toContain('boom');
	});

	it('moves a pending action to rejected, expired, confirmed or failed', async () => {
		for (const status of [
			'rejected',
			'expired',
			'confirmed',
			'failed',
		] as const) {
			const store = await seeded();
			const done = await store.updateAction('act-1', 'a', { status });
			expect(done?.status).toBe(status);
		}
	});

	it('writes only while the action has a "from" status', async () => {
		const store = await seeded();
		// pending, but the caller expects a claim
		expect(
			await store.updateAction(
				'act-1',
				'a',
				{ status: 'confirmed', result: ok },
				{ from: 'running' },
			),
		).toBeUndefined();
		await store.updateAction('act-1', 'a', { status: 'running' });
		// claimed, so a second claim from pending finds nothing
		expect(
			await store.updateAction('act-1', 'a', { status: 'running' }),
		).toBeUndefined();
		expect((await store.findAction('act-1', 'a'))?.status).toBe('running');
		// a list of statuses matches any of them
		const done = await store.updateAction(
			'act-1',
			'a',
			{ status: 'failed', result: bad },
			{ from: ['running', 'pending'] },
		);
		expect(done?.status).toBe('failed');
		// a terminal status never moves again
		expect(
			await store.updateAction(
				'act-1',
				'a',
				{ status: 'confirmed' },
				{ from: 'running' },
			),
		).toBeUndefined();
	});

	it('lets only one of two concurrent claims win', async () => {
		const store = await seeded();
		const results = await Promise.all([
			store.updateAction('act-1', 'a', { status: 'running' }),
			store.updateAction('act-1', 'a', { status: 'running' }),
			store.updateAction('act-1', 'a', { status: 'running' }),
		]);
		expect(results.filter(Boolean)).toHaveLength(1);
	});

	it('refuses an illegal transition before touching the store', async () => {
		const store = await seeded();
		const code = async (p: Promise<unknown>) =>
			p.then(
				() => 'none',
				(e: unknown) => (e as { code?: string }).code,
			);
		expect(
			await code(
				store.updateAction(
					'act-1',
					'a',
					{ status: 'rejected' },
					{ from: 'running' },
				),
			),
		).toBe('INVALID_ACTION_TRANSITION');
		expect(
			await code(
				store.updateAction(
					'act-1',
					'a',
					{ status: 'running' },
					{ from: 'confirmed' },
				),
			),
		).toBe('INVALID_ACTION_TRANSITION');
		expect(
			await code(
				store.updateAction(
					'act-1',
					'a',
					{ status: 'confirmed' },
					{ from: ['pending', 'rejected'] },
				),
			),
		).toBe('INVALID_ACTION_TRANSITION');
		expect(
			await code(
				store.updateAction('act-1', 'a', { status: 'running' }, { from: [] }),
			),
		).toBe('INVALID_ACTION_TRANSITION');
		expect((await store.findAction('act-1', 'a'))?.status).toBe('pending');
	});
}
