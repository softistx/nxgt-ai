import { describe, expect, it } from 'bun:test';
import {
	executeTool,
	type ProposedAction,
	runConfirmedAction,
} from '@nxgt/ai-core';
import type { GraphQLError } from 'graphql';
import { z } from 'zod';
import { book, build1, call, ctx, rejects, strict } from '../test/helpers';

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

describe('graphqlTools: application codes and mapErrors', () => {
	const run = (id: string, extra = {}) =>
		executeTool(build1([strict], extra), call('get_strict', { id }), ctx);

	it('keeps a dotted or dashed application code, never the message', async () => {
		const text = JSON.stringify(await run('dotted'));
		expect(text).toContain('auth.errors.forbidden');
		expect(text).not.toContain('INTERNAL_ERROR');
		expect(text).not.toContain('u-77');
		expect(text).not.toContain('app.ts');
	});

	it('still hides a code with spaces or markup', async () => {
		const text = JSON.stringify(await run('bad-code'));
		expect(text).toContain('INTERNAL_ERROR');
		expect(text).not.toContain('<b>');
	});

	it('shows only what mapErrors returns, given the errors and the operation', async () => {
		const seen: unknown[] = [];
		const out = await run('missing', {
			mapErrors: (errors: readonly GraphQLError[], info: unknown) => {
				seen.push(errors[0]?.message, info);
				return [{ code: 'validation.errors.invalid-input', params: { n: 2 } }];
			},
		});
		if (!out.isError) throw new Error('expected an error');
		const text = out.error.message;
		expect(text).toContain('validation.errors.invalid-input');
		expect(text).toContain('"params":{"n":2}');
		expect(text).not.toContain('NOT_FOUND');
		expect(seen).toEqual([
			'Book row 42 not found in table books',
			{ operation: 'get_strict' },
		]);
	});

	it('applies the hook to partial errors in the output too', async () => {
		const tool = build1(
			[
				{
					name: 'two',
					description: 'Two reads',
					document: '{ a: book(id: "1") { id } b: book(id: "missing") { id } }',
				},
			],
			{ mapErrors: () => [{ code: 'custom.code' }] },
		);
		const out = await executeTool(tool, call('two', {}), ctx);
		expect(out).toMatchObject({
			isError: false,
			output: { data: { a: { id: '1' } }, errors: [{ code: 'custom.code' }] },
		});
	});

	it('sanitises what the hook returns', async () => {
		const out = await run('missing', {
			mapErrors: () => [
				{
					code: 'ok.code',
					message: 'row 42 leaked',
					params: { a: 1, deep: { x: 1 } },
					extra: 'nope',
				},
			],
		});
		if (!out.isError) throw new Error('expected an error');
		const text = out.error.message;
		expect(text).toContain('ok.code');
		expect(text).toContain('"params":{"a":1}');
		expect(text).not.toContain('leaked');
		expect(text).not.toContain('nope');
		expect(text).not.toContain('deep');
	});

	it.each([
		[
			'throws',
			() => {
				throw new Error('hook secret');
			},
		],
		['returns nothing', () => undefined],
		['returns a bad code', () => [{ code: 'bad code!' }]],
		['returns an empty list', () => []],
		['returns a promise', () => Promise.resolve([{ code: 'x' }])],
	])('falls back to the default mapping when the hook %s', async (_n, hook) => {
		const text = JSON.stringify(await run('missing', { mapErrors: hook }));
		expect(text).toContain('NOT_FOUND');
		expect(text).not.toContain('hook secret');
		expect(text).not.toContain('row 42');
	});

	it('rejects a mapErrors that is not a function', () => {
		expect(rejects(strict, { mapErrors: 'x' }).code).toBe('INVALID_OPTIONS');
	});
});
