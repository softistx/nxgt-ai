import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '@graphql-codegen/cli';
import { typeDefs } from '../test/fixtures';
import { type OperationsManifestConfig, plugin } from './codegen';

// These specs run the real graphql-codegen CLI (generate()) on files in a
// temp directory, as a consumer's codegen.ts does.

let dir: string;
let count = 0;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'ai-graphql-codegen-'));
	writeFileSync(join(dir, 'schema.graphql'), typeDefs);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function run(
	files: Record<string, string>,
	config: OperationsManifestConfig = {},
): Promise<{ manifest: string; zod: string }> {
	const ops = join(dir, `ops-${++count}`);
	mkdirSync(ops);
	for (const [name, text] of Object.entries(files)) {
		writeFileSync(join(ops, name), text);
	}
	const out = await generate(
		{
			cwd: dir,
			schema: join(dir, 'schema.graphql'),
			documents: join(ops, '*.graphql'),
			pluginLoader: async (name: string) =>
				name === 'manifest' ? { plugin } : await import(name),
			generates: {
				[join(dir, 'operations.ts')]: {
					plugins: ['manifest'],
					config: config as Record<string, unknown>,
				},
				[join(dir, 'zod.ts')]: {
					plugins: ['@nxgt/graphql-codegen-zod'],
					config: config as Record<string, unknown>,
				},
			},
		},
		false,
	);
	const text = (name: string) =>
		out.find((o: { filename: string }) => o.filename.endsWith(name))?.content ??
		'';
	return { manifest: text('operations.ts'), zod: text('zod.ts') };
}

describe('through the real graphql-codegen CLI', () => {
	test('reads # tool: comments of a file with several operations', async () => {
		const { manifest } = await run({
			'ops.graphql': `# tool: Reads one book.
query GetBook($id: ID!) { book(id: $id) { id } }

# tool: Lists books.
# Newest first.
query ListBooks($limit: Int) { books(limit: $limit) { id } }
`,
		});
		expect(manifest).toContain("description: 'Reads one book.'");
		expect(manifest).toContain("description: 'Lists books. Newest first.'");
	});

	test('reads comments of a file with CRLF line endings', async () => {
		const { manifest } = await run({
			'crlf.graphql':
				'# tool: First.\r\n# Second line.\r\nquery GetBook($id: ID!) {\r\n  book(id: $id) { id }\r\n}\r\n',
		});
		expect(manifest).toContain("description: 'First. Second line.'");
	});

	test('a comment above a fragment does not attach to the next operation', async () => {
		await expect(
			run({
				'frag.graphql': `# tool: Describes the fragment, not the query.
fragment BookFields on Book { id title }
query GetBook($id: ID!) { book(id: $id) { ...BookFields } }
`,
			}),
		).rejects.toThrow(/operation "GetBook" has no description/);
	});

	test('a fragment in another file is included', async () => {
		const { manifest } = await run({
			'a.graphql': 'fragment BookFields on Book { id title }',
			'b.graphql':
				'# tool: Reads one book.\nquery GetBook($id: ID!) { book(id: $id) { ...BookFields } }',
		});
		expect(manifest).toContain('fragment BookFields on Book');
	});
});

describe('names match @nxgt/graphql-codegen-zod', () => {
	const docs = {
		'n.graphql': `# tool: a
query getHTTPThing($id: ID!) { book(id: $id) { id } }
# tool: b
query get_book($id: ID!) { book(id: $id) { id } }
# tool: c
query ListBooksQuery($limit: Int) { books(limit: $limit) { id } }
# tool: d
mutation RENEW_loan($bookId: ID!) { renewLoan(bookId: $bookId) { id } }
`,
	};
	const configs: OperationsManifestConfig[] = [
		{},
		{ dedupeOperationSuffix: true },
		{ namingConvention: 'keep' },
		{ namingConvention: 'keep', dedupeOperationSuffix: true },
		{ omitOperationSuffix: true, schemaPrefix: 'zz', typesSuffix: 'T' },
		{ namingConvention: { typeNames: 'change-case-all#camelCase' } },
		{ typesPrefix: 'Api' },
	];
	for (const config of configs) {
		test(`config ${JSON.stringify(config)}`, async () => {
			const { manifest, zod } = await run(docs, config);
			const imported = /import \{([^}]*)\} from '\.\/zod'/
				.exec(manifest)?.[1]
				?.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			expect(imported?.length).toBe(4);
			const exported = new Set(
				[...zod.matchAll(/export const (\w+)/g)].map((m) => m[1]),
			);
			for (const name of imported ?? []) expect(exported.has(name)).toBe(true);
		});
	}
});
