import { describe, expect, test } from 'bun:test';
import type { Types } from '@graphql-codegen/plugin-helpers';
import { parse } from 'graphql';
import { librarySchema } from '../test/fixtures';
import { type OperationsManifestConfig, plugin } from './codegen';
import { graphqlTools } from './index';

const schema = librarySchema();

const sources = [
	`fragment BookFields on Book { id title }

# tool: Reads one book by id.
# Returns its id and title.
query GetBook($id: ID!) { book(id: $id) { ...BookFields } }
`,
	`# unrelated note

# tool: Lists the books, newest first.
query ListBooks($limit: Int) {
  books(limit: $limit) { ...BookFields }
}

# tool: Renews a loan.
mutation RenewLoan($bookId: ID!) { renewLoan(bookId: $bookId) { ...BookFields } }
`,
];

function files(...texts: string[]): Types.DocumentFile[] {
	return texts.map((rawSDL, i) => ({
		location: `ops-${i}.graphql`,
		rawSDL,
		document: parse(rawSDL, { noLocation: true }),
	}));
}

function generate(
	texts: string[],
	config: OperationsManifestConfig = {},
): string {
	const out = plugin(schema, files(...texts), config, {
		outputFile: 'operations.ts',
	});
	return out as string;
}

describe('codegen plugin', () => {
	test('the manifest of a query and a mutation with a fragment', () => {
		expect(generate(sources)).toMatchSnapshot();
	});

	test('is stable whatever the order of the documents', () => {
		const [a, b] = sources as [string, string];
		expect(generate([a, b])).toBe(generate([b, a]));
	});

	test('a graphql 17 description wins over the comment', () => {
		const rawSDL = 'query GetBook($id: ID!) { book(id: $id) { id } }';
		const document = parse(rawSDL);
		const op = document.definitions[0] as unknown as {
			description: unknown;
		};
		// graphql 16 cannot parse a description: set the node 17 would produce.
		op.description = { kind: 'StringValue', value: 'From the description.' };
		const out = plugin(
			schema,
			[{ rawSDL: '', document }],
			{},
			{ outputFile: 'x.ts' },
		) as string;
		expect(out).toContain("description: 'From the description.'");
		expect(out).not.toContain('"""');
	});

	test('options: export name, import paths, names, schema naming', () => {
		const out = generate([sources[0] as string], {
			exportName: 'libraryTools',
			zodImport: '../generated/zod.js',
			typesImport: '../src/index',
			names: { GetBook: 'get_book' },
			schemaPrefix: 'zod',
			omitOperationSuffix: true,
		});
		expect(out).toContain('export const libraryTools = [');
		expect(out).toContain("from '../generated/zod.js'");
		expect(out).toContain("name: 'get_book'");
		expect(out).toContain('variables: zodGetBookVariables');
	});

	test('dedupes an operation suffix like codegen-zod', () => {
		const out = generate(
			['# tool: x\nquery BookQuery($id: ID!) { book(id: $id) { id } }'],
			{ dedupeOperationSuffix: true },
		);
		expect(out).toContain('variables: zBookQueryVariables');
	});

	test('an operation without variables gets no variables key or import', () => {
		const out = generate([
			'# tool: All books.\nquery AllBooks { books { id } }',
		]);
		expect(out).not.toContain('variables');
		expect(out).not.toContain("from './zod'");
	});

	test('a missing description names the operation', () => {
		expect(() =>
			generate(['query GetBook($id: ID!) { book(id: $id) { id } }']),
		).toThrow(/operation "GetBook" has no description/);
	});

	test('a blank line cuts the comment from the operation', () => {
		expect(() =>
			generate(['# tool: Far away.\n\nquery AllBooks { books { id } }']),
		).toThrow(/operation "AllBooks" has no description/);
	});

	test('the same fragment with different text is refused', () => {
		expect(() =>
			generate([
				'fragment F on Book { id }',
				'fragment F on Book { title }\n# tool: x\nquery Q { books { ...F } }',
			]),
		).toThrow(/fragment "F" is defined in two documents/);
		expect(() =>
			generate([
				'fragment F on Book { id }',
				'fragment F on Book { id }\n# tool: x\nquery Q { books { ...F } }',
			]),
		).not.toThrow();
	});

	test('options are validated', () => {
		const q = ['# tool: x\nquery Q { books { id } }'];
		expect(() => generate(q, { schemaPrefix: 'a-b' })).toThrow(/schemaPrefix/);
		expect(() => generate(q, { typesSuffix: ' ' })).toThrow(/typesSuffix/);
		expect(() => generate(q, { zodImport: '' })).toThrow(/zodImport/);
		expect(() => generate(q, { typesImport: '' })).toThrow(/typesImport/);
	});

	test('a subscription is refused', () => {
		expect(() =>
			generate(['# tool: Watches.\nsubscription Added { bookAdded { id } }']),
		).toThrow(/operation "Added" is a subscription/);
	});

	test('duplicate names are refused', () => {
		const one = '# tool: One.\nquery Same { books { id } }';
		expect(() => generate([one, one])).toThrow(
			/two operations are named "Same"/,
		);
		expect(() =>
			generate([`${one}\n# tool: Two.\nquery Other { books { id } }`], {
				names: { Other: 'Same', Same: 'Same' },
			}),
		).toThrow(/two operations are named "Same"/);
	});

	test('an anonymous operation, a unknown fragment and a bad mapping are refused', () => {
		expect(() => generate(['# tool: x\n{ books { id } }'])).toThrow(
			/anonymous/,
		);
		expect(() =>
			generate(['# tool: x\nquery A { books { ...Nope } }']),
		).toThrow(/fragment "Nope"/);
		expect(() =>
			generate(['# tool: x\nquery A { books { id } }'], { names: { B: 'b' } }),
		).toThrow(/maps "B"/);
		expect(() =>
			generate(['# tool: x\nquery A { books { id } }'], {
				names: { A: 'a b' },
			}),
		).toThrow(/tool name "a b"/);
		expect(() =>
			generate(['# tool: x\nquery A { books { id } }'], { exportName: '1x' }),
		).toThrow(/exportName/);
	});

	test('quotes survive in descriptions', () => {
		const out = generate([
			"# tool: Reads the reader's 'book'.\nquery A { books { id } }",
		]);
		expect(out).toContain("description: 'Reads the reader\\'s \\'book\\'.'");
	});
});

describe('generated manifest', () => {
	const committed = 'test/codegen/operations.generated.ts';

	test('matches the committed file, which typechecks and feeds graphqlTools', async () => {
		const out = generate(sources, {
			typesImport: '../../src/index',
			zodImport: './zod',
		});
		const file = Bun.file(`${import.meta.dir}/../${committed}`);
		if (process.env['UPDATE_CODEGEN'] === '1') await Bun.write(file, out);
		expect(await file.text()).toBe(out);

		const { operations } = await import('../test/codegen/operations.generated');
		const tools = graphqlTools({ schema, operations });
		expect(tools.map((t) => t.name)).toEqual([
			'GetBook',
			'ListBooks',
			'RenewLoan',
		]);
		const get = tools.find((t) => t.name === 'GetBook');
		expect(get?.description).toBe(
			'Reads one book by id. Returns its id and title.',
		);
		expect(get?.validate({ id: 'b1' }).ok).toBe(true);
		expect(get?.validate({}).ok).toBe(false);
	});
});
