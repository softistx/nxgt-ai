import { describe, expect, it } from 'bun:test';
import { executeTool } from '@nxgt/ai-core';
import { parse } from 'graphql';
import { book, build, build1, call, ctx, rejects } from '../test/helpers';
import { GraphqlToolsError } from './index';

describe('graphqlTools: build-time checks', () => {
	it('rejects an invalid operation', () => {
		expect(rejects({ ...book, document: '{ nope }' }).code).toBe(
			'INVALID_OPERATION',
		);
	});

	it('rejects a subscription', () => {
		const e = rejects({
			...book,
			document: 'subscription { bookAdded { id } }',
		});
		expect(e.message).toContain('subscription');
	});

	it('rejects a duplicate name', () => {
		expect(() => build([book, book])).toThrow(GraphqlToolsError);
	});

	it('rejects a malformed forbidFields entry', () => {
		expect(rejects(book, { forbidFields: ['address'] }).code).toBe(
			'INVALID_OPERATION',
		);
	});

	it('rejects @defer and @stream', () => {
		const defer = rejects({
			...book,
			document:
				'query Q($id: ID!) { book(id: $id) { id ... @defer { title } } }',
		});
		expect(defer.message).toContain('@defer');
		const stream = rejects({
			...book,
			document: '{ books { id } }'.replace('books', 'books @stream'),
		});
		expect(stream.message).toContain('@stream');
	});
});

describe('graphqlTools: documents', () => {
	const multi = `
		query One($id: ID!) { book(id: $id) { id } }
		query Two { books(limit: 1) { title } }`;

	it('needs operationName when a document holds several operations', () => {
		expect(rejects({ ...book, document: multi }).code).toBe(
			'INVALID_OPERATION',
		);
	});

	it('runs the operation named by operationName', async () => {
		const tool = build1([
			{
				name: 'two',
				description: 'Second',
				document: multi,
				operationName: 'Two',
			},
		]);
		const out = await executeTool(tool, call('two', {}), ctx);
		expect(out).toMatchObject({
			output: { data: { books: [{ title: 'Title number 0' }] } },
		});
	});

	it('accepts a parsed DocumentNode', async () => {
		const tool = build1([{ ...book, document: parse(String(book.document)) }]);
		const out = await executeTool(tool, call('get_book', { id: '1' }), ctx);
		expect(out).toMatchObject({ output: { data: { book: { id: '1' } } } });
	});

	it('copies a DocumentNode: changing it after build changes nothing', async () => {
		const document = parse(String(book.document));
		const tool = build1([{ ...book, document }]);
		// Swap the selection for a forbidden-looking, different one.
		const other = parse('{ member(id: "1") { address } }');
		(document as { definitions: unknown }).definitions = other.definitions;
		const out = await executeTool(tool, call('get_book', { id: '1' }), ctx);
		expect(out).toMatchObject({ output: { data: { book: { id: '1' } } } });
	});

	it('skips introspection fields, and still rejects through @skip and @include', () => {
		expect(
			build(
				[{ ...book, document: '{ __typename member(id: "1") { name } }' }],
				{ forbidFields: ['Query.__typename'] },
			),
		).toHaveLength(1);
		expect(
			rejects(
				{
					...book,
					document:
						'query Q($on: Boolean!) { member(id: "1") { address @include(if: $on) phone @skip(if: true) } }',
					variables: undefined as never,
				},
				{ forbidFields: ['Person.phone'] },
			).field,
		).toBe('Person.phone');
	});
});
