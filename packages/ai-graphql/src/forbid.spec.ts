import { describe, expect, it } from 'bun:test';
import { librarySchema } from '../test/fixtures';
import { GraphqlToolsError, graphqlTools } from './index';

const schema = librarySchema();

function build(document: string, forbidFields: string[]) {
	return graphqlTools({
		schema,
		forbidFields,
		operations: [{ name: 'op_one', description: 'An operation', document }],
	});
}

function failure(document: string, forbidFields: string[]): GraphqlToolsError {
	try {
		build(document, forbidFields);
	} catch (error) {
		expect(error).toBeInstanceOf(GraphqlToolsError);
		return error as GraphqlToolsError;
	}
	throw new Error('expected a throw');
}

describe('forbidFields', () => {
	it('rejects a direct selection, naming operation, field and path', () => {
		const e = failure('{ member(id: "1") { name address } }', [
			'Person.address',
		]);
		expect(e.code).toBe('FORBIDDEN_FIELD');
		expect(e.operation).toBe('op_one');
		expect(e.field).toBe('Person.address');
		expect(e.path).toBe('member.address');
		expect(e.message).toContain('op_one');
	});

	it('rejects a nested selection', () => {
		const e = failure('{ book(id: "1") { borrower { phone } } }', [
			'Person.phone',
		]);
		expect(e.path).toBe('book.borrower.phone');
	});

	it('uses the alias in the path, not to dodge the check', () => {
		const e = failure('{ member(id: "1") { x: address } }', ['Person.address']);
		expect(e.path).toBe('member.x');
	});

	it('rejects a field behind a named fragment', () => {
		const e = failure(
			'{ book(id: "1") { borrower { ...Contact } } } fragment Contact on Member { name address }',
			['Person.address'],
		);
		expect(e.code).toBe('FORBIDDEN_FIELD');
		expect(e.path).toBe('book.borrower.address');
		expect(e.message).toContain('Contact');
	});

	it('rejects a field behind fragments of fragments', () => {
		const e = failure(
			'{ member(id: "1") { ...A } } fragment A on Member { ...B } fragment B on Person { phone }',
			['Person.phone'],
		);
		expect(e.message).toContain('A > B');
	});

	it('rejects a field behind an inline fragment', () => {
		const e = failure(
			'{ contact(id: "1") { ... on Librarian { nationalId } } }',
			['Librarian.nationalId'],
		);
		expect(e.field).toBe('Librarian.nationalId');
		expect(e.path).toBe('contact.nationalId');
	});

	it('rejects an interface field read through a concrete type', () => {
		failure('{ contact(id: "1") { ... on Member { address } } }', [
			'Person.address',
		]);
	});

	it('rejects a concrete-type field read through a union', () => {
		failure('{ contact(id: "1") { ... on Librarian { nationalId } } }', [
			'Librarian.nationalId',
		]);
	});

	it('ignores __typename and unrelated fields', () => {
		expect(
			build('{ member(id: "1") { __typename id name } }', ['Person.address']),
		).toHaveLength(1);
	});

	it('does not confuse the same field name on another type', () => {
		expect(build('{ book(id: "1") { title } }', ['Person.title'])).toHaveLength(
			1,
		);
	});
});
