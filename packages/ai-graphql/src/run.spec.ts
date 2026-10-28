import { describe, expect, it } from 'bun:test';
import { executeTool, runAgent } from '@nxgt/ai-core';
import { collect, fakeModel } from '@nxgt/ai-testing';
import { z } from 'zod';
import { book, build, build1, call } from '../test/helpers';

describe('graphqlTools: happy path', () => {
	it('runs a query in process with the per-call context', async () => {
		const tool = build1([book], {
			context: ({ context }: { context: string }) => ({ viewer: context }),
		});
		expect(tool?.confirm).toBe(false);
		expect(tool?.inputSchema).toMatchObject({ type: 'object' });
		const out = await executeTool(tool, call('get_book', { id: 'b1' }), {
			context: 'ada',
		});
		expect(out).toMatchObject({
			isError: false,
			output: { data: { book: { id: 'b1', title: 'Book for ada' } } },
		});
	});

	it('passes the run context through when no context builder is given', async () => {
		const tool = build1([book]);
		const out = await executeTool(tool, call('get_book', { id: 'b1' }), {
			context: { viewer: 'bob' },
		});
		expect(out).toMatchObject({
			output: { data: { book: { title: 'Book for bob' } } },
		});
	});

	it('works inside runAgent', async () => {
		const tools = build([book]);
		const model = fakeModel([
			{ toolCalls: [{ name: 'get_book', input: { id: '7' } }] },
			{ text: 'done' },
		]);
		const events = await collect(
			runAgent({
				model,
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
				tools,
				context: { viewer: 'eve' },
			}),
		);
		expect(JSON.stringify(events)).toContain('Book for eve');
	});

	it('takes no variables by default', async () => {
		const tool = build1([
			{
				name: 'all_books',
				description: 'Lists books',
				document: '{ books(limit: 2) { id } }',
			},
		]);
		const out = await executeTool(tool, call('all_books', {}), {
			context: { viewer: 'x' },
		});
		expect(out).toMatchObject({
			output: { data: { books: [{ id: '0' }, { id: '1' }] } },
		});
	});
});

describe('graphqlTools: variables', () => {
	it('answers INVALID_TOOL_INPUT without executing', async () => {
		const tool = build1([book]);
		const out = await executeTool(tool, call('get_book', { id: 42 }), {
			context: { viewer: 'x' },
		});
		expect(out).toMatchObject({
			isError: true,
			error: { code: 'INVALID_TOOL_INPUT' },
		});
	});
});

describe('graphqlTools: mutations', () => {
	it('become confirm tools', () => {
		const tools = build([
			book,
			{
				name: 'renew_loan',
				description: 'Renews a loan',
				document:
					'mutation Renew($bookId: ID!) { renewLoan(bookId: $bookId) { id title } }',
				variables: z.object({ bookId: z.string() }),
			},
		]);
		expect(tools.map((t) => [t.name, t.confirm])).toEqual([
			['get_book', false],
			['renew_loan', true],
		]);
	});

	it('are proposed by the loop, not run', async () => {
		const tools = build([
			{
				name: 'renew_loan',
				description: 'Renews a loan',
				document:
					'mutation Renew($bookId: ID!) { renewLoan(bookId: $bookId) { id } }',
				variables: z.object({ bookId: z.string() }),
			},
		]);
		const model = fakeModel([
			{ toolCalls: [{ name: 'renew_loan', input: { bookId: '1' } }] },
			{ text: 'ok' },
		]);
		const events = await collect(
			runAgent({
				model,
				messages: [{ role: 'user', parts: [{ type: 'text', text: 'renew' }] }],
				tools,
			}),
		);
		expect(JSON.stringify(events)).toContain('pending');
	});
});
