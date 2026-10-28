import { describe, expect, it } from 'bun:test';
import {
	executeTool,
	type ProposedAction,
	runConfirmedAction,
} from '@nxgt/ai-core';
import { z } from 'zod';
import { book, build1, call, ctx, strict } from '../test/helpers';

describe('graphqlTools: errors as codes', () => {
	const run = async (id: string) => {
		const tool = build1([strict]);
		return executeTool(tool, call('get_strict', { id }), {
			context: { viewer: 'x' },
		});
	};

	it('shows code, fields and scalar params, never the message', async () => {
		const out = await run('missing');
		expect(out).toMatchObject({
			isError: true,
			error: { code: 'TOOL_FAILED' },
		});
		expect(JSON.stringify(out)).toContain('NOT_FOUND');
		if (!out.isError) throw new Error('expected an error');
		expect(out.error.message).toContain('"fields":["id"]');
		expect(out.error.message).toContain('"params":{"id":"missing"}');
		expect(JSON.stringify(out)).not.toContain('row 42');
	});

	it('keeps partial data with mapped errors', async () => {
		const tool = build1([
			{
				name: 'two',
				description: 'Two reads',
				document: '{ a: book(id: "1") { id } b: book(id: "missing") { id } }',
			},
		]);
		const out = await executeTool(tool, call('two', {}), {
			context: { viewer: 'x' },
		});
		expect(out).toMatchObject({
			isError: false,
			output: {
				data: { a: { id: '1' }, b: null },
				errors: [
					{
						code: 'NOT_FOUND',
						path: ['b'],
						fields: ['id'],
						params: { id: 'missing' },
					},
				],
			},
		});
		expect(JSON.stringify(out)).not.toContain('secret');
		expect(JSON.stringify(out)).not.toContain('row 42');
	});

	it('maps an error without a code to INTERNAL_ERROR and hides its message', async () => {
		const out = await run('boom');
		expect(JSON.stringify(out)).toContain('INTERNAL_ERROR');
		expect(JSON.stringify(out)).not.toContain('ECONNREFUSED');
		expect(JSON.stringify(out)).not.toContain('at ');
	});
});

describe('graphqlTools: failure semantics', () => {
	const cancel = {
		name: 'cancel_loan',
		description: 'Cancels a loan',
		document: 'mutation C($bookId: ID!) { cancelLoan(bookId: $bookId) { id } }',
		variables: z.object({ bookId: z.string() }),
	};

	it('fails a confirmed mutation whose nullable root errors', async () => {
		const tool = build1([cancel]);
		const action: ProposedAction = {
			id: 'a1',
			tool: 'cancel_loan',
			input: { bookId: '1' },
			status: 'pending',
			expiresAt: Date.now() + 60_000,
		};
		const done = await runConfirmedAction(action, [tool], ctx);
		expect(done.status).toBe('failed');
		expect(JSON.stringify(done.result)).toContain('CONFLICT');
		expect(JSON.stringify(done.result)).not.toContain('row 9');
	});

	it('throws for a query whose nullable roots all fail', async () => {
		const tool = build1([
			{
				name: 'one',
				description: 'One',
				document: '{ a: book(id: "missing") { id } }',
			},
		]);
		const out = await executeTool(tool, call('one', {}), ctx);
		expect(out).toMatchObject({
			isError: true,
			error: { code: 'TOOL_FAILED' },
		});
	});

	it('does not leak what a context builder throws, and keeps the cause', async () => {
		const tool = build1([book], {
			context: () => {
				throw new Error('db password=hunter2 at /srv/app.ts');
			},
		});
		const out = await executeTool(tool, call('get_book', { id: '1' }), ctx);
		expect(out).toMatchObject({
			isError: true,
			error: { code: 'TOOL_FAILED' },
		});
		const text = JSON.stringify(out);
		expect(text).toContain('INTERNAL_ERROR');
		expect(text).not.toContain('hunter2');
		expect(text).not.toContain('app.ts');
	});

	it('rethrows an abort from the context builder unchanged', async () => {
		const reason = new Error('stop');
		const controller = new AbortController();
		const tool = build1([book], {
			context: () => {
				controller.abort(reason);
				throw new Error('whatever');
			},
		});
		await expect(
			executeTool(tool, call('get_book', { id: '1' }), {
				...ctx,
				signal: controller.signal,
			}),
		).rejects.toBe(reason);
	});
});
