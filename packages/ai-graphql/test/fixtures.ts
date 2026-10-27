import { buildSchema, GraphQLError, type GraphQLSchema } from 'graphql';

/** A small library schema shared by the specs. */
export const typeDefs = /* GraphQL */ `
	interface Person { id: ID! name: String! address: String phone: String }
	type Member implements Person {
		id: ID! name: String! address: String phone: String
		loans: [Book!]!
	}
	type Librarian implements Person {
		id: ID! name: String! address: String phone: String
		nationalId: String
	}
	type Book { id: ID! title: String! borrower: Member }
	union Contact = Member | Librarian
	type Query {
		book(id: ID!): Book
		strictBook(id: ID!): Book!
		books(limit: Int): [Book!]!
		member(id: ID!): Member
		contact(id: ID!): Contact
	}
	type Mutation { renewLoan(bookId: ID!): Book! }
	type Subscription { bookAdded: Book }
`;

export interface Ctx {
	viewer: string;
}

function field<T>(fields: Record<string, T>, name: string): T {
	const f = fields[name];
	if (!f) throw new Error(`no field ${name}`);
	return f;
}

export function librarySchema(): GraphQLSchema {
	const schema = buildSchema(typeDefs);
	const query = schema.getQueryType()?.getFields() ?? {};
	const mutation = schema.getMutationType()?.getFields() ?? {};
	const member = {
		id: 'm1',
		name: 'Ada',
		address: '1 Main St',
		phone: '555',
		loans: [],
	};
	field(query, 'book').resolve = (_s, args: { id: string }, ctx: Ctx) => {
		if (args.id === 'missing') {
			throw new GraphQLError('Book row 42 not found in table books', {
				extensions: {
					code: 'NOT_FOUND',
					fields: ['id'],
					params: { id: args.id, secret: { nested: true } },
				},
			});
		}
		if (args.id === 'boom')
			throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
		return { id: args.id, title: `Book for ${ctx.viewer}`, borrower: member };
	};
	field(query, 'books').resolve = (_s, args: { limit?: number }) =>
		Array.from({ length: args.limit ?? 50 }, (_, i) => ({
			id: String(i),
			title: `Title number ${i}`,
		}));
	const bookResolve = field(query, 'book').resolve;
	if (bookResolve) field(query, 'strictBook').resolve = bookResolve;
	field(query, 'member').resolve = () => member;
	field(mutation, 'renewLoan').resolve = (_s, args: { bookId: string }) => ({
		id: args.bookId,
		title: 'Renewed',
	});
	return schema;
}
