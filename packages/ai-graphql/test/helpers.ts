import { z } from 'zod';
import {
	type GraphqlOperation,
	type GraphqlToolsError,
	graphqlTools,
} from '../src/index';
import { librarySchema } from './fixtures';

export const schema = librarySchema();

export const book: GraphqlOperation = {
	name: 'get_book',
	description: 'Reads one book',
	document: 'query GetBook($id: ID!) { book(id: $id) { id title } }',
	variables: z.object({ id: z.string().describe('The book id') }),
};

export const strict: GraphqlOperation = {
	...book,
	name: 'get_strict',
	document: 'query S($id: ID!) { strictBook(id: $id) { id } }',
};

export const call = (name: string, input: unknown) => ({
	type: 'tool-call' as const,
	id: 'c1',
	name,
	input,
});

export const ctx = { context: { viewer: 'x' } };

export const build = (operations: GraphqlOperation[], extra = {}) =>
	graphqlTools({ schema, operations, ...extra });

export const build1 = (operations: GraphqlOperation[], extra = {}) => {
	const [tool] = build(operations, extra);
	if (!tool) throw new Error('no tool');
	return tool;
};

export const rejects = (
	operation: GraphqlOperation,
	extra: Record<string, unknown> = {},
): GraphqlToolsError => {
	try {
		build([operation], extra);
	} catch (error) {
		return error as GraphqlToolsError;
	}
	throw new Error('expected graphqlTools to throw');
};
