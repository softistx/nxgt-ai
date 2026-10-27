import { describe, expect, it } from 'bun:test';
import { executeTool, runAgent } from '@nxgt/ai-core';
import { collect, fakeModel } from '@nxgt/ai-testing';
import { z } from 'zod';
import { librarySchema } from '../test/fixtures';
import {
	type GraphqlOperation,
	GraphqlToolsError,
	graphqlTools,
} from './index';

const schema = librarySchema();
const idVars = z.object({ id: z.string().describe('The book id') });

const book: GraphqlOperation = {
	name: 'get_book',
	description: 'Reads one book',
	document: 'query GetBook($id: ID!) { book(id: $id) { id title } }',
	variables: idVars,
};

const strict: GraphqlOperation = {
	...book,
	name: 'get_strict',
	document: 'query S($id: ID!) { strictBook(id: $id) { id } }',
};

const call = (name: string, input: unknown) => ({
	type: 'tool-call' as const,
	id: 'c1',
	name,
	input,
});

const build = (operations: GraphqlOperation[], extra = {}) =>
	graphqlTools({ schema, operations, ...extra });

const build1 = (operations: GraphqlOperation[], extra = {}) => {
	const [tool] = build(operations, extra);
	if (!tool) throw new Error('no tool');
	return tool;
};

const rejects = (operation: GraphqlOperation, forbidFields: string[]) => {
	try {
		build([operation], { forbidFields });
	} catch (error) {
		return error as GraphqlToolsError;
	}
	throw new Error('expected graphqlTools to throw');
};

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

describe('graphqlTools: truncation', () => {
	const list: GraphqlOperation = {
		name: 'list_books',
		description: 'Lists books',
		document: 'query L($limit: Int) { books(limit: $limit) { id title } }',
		variables: z.object({ limit: z.number().int().optional() }),
	};

	it('cuts a long result and says so', async () => {
		const tool = build1([list], { maxResultChars: 100 });
		const out = await executeTool(tool, call('list_books', { limit: 50 }), {
			context: { viewer: 'x' },
		});
		if (out.isError) throw new Error('unexpected error');
		const o = out.output as {
			truncated: boolean;
			originalChars: number;
			preview: string;
			note: string;
		};
		expect(o.truncated).toBe(true);
		expect(o.preview).toHaveLength(100);
		expect(o.originalChars).toBeGreaterThan(100);
		expect(o.note).toContain('narrower');
	});

	it('leaves a short result alone', async () => {
		const tool = build1([list], { maxResultChars: 100 });
		const out = await executeTool(tool, call('list_books', { limit: 1 }), {
			context: { viewer: 'x' },
		});
		expect(out).toMatchObject({ output: { data: { books: [{ id: '0' }] } } });
	});
});

describe('graphqlTools: build-time checks', () => {
	it('rejects an invalid operation', () => {
		const e = rejects({ ...book, document: '{ nope }' }, []);
		expect(e.code).toBe('INVALID_OPERATION');
	});
	it('rejects a subscription', () => {
		const e = rejects(
			{ ...book, document: 'subscription { bookAdded { id } }' },
			[],
		);
		expect(e.message).toContain('subscription');
	});
	it('rejects a duplicate name', () => {
		expect(() => build([book, book])).toThrow(GraphqlToolsError);
	});
	it('rejects a malformed forbidFields entry', () => {
		expect(rejects(book, ['address']).code).toBe('INVALID_OPERATION');
	});
});
