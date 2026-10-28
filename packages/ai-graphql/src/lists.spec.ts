import { describe, expect, it } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeTool } from '@nxgt/ai-core';
import * as zodPlugin from '@nxgt/graphql-codegen-zod';
import { buildSchema, parse } from 'graphql';
import { z } from 'zod';
import {
	zDateList,
	zMatrixVariables,
	zTagMutationVariables,
	zThingsQueryVariables,
} from '../test/lists';
import { graphqlTools } from './index';

const schema = buildSchema(`
	input TagFilter { tags: [String!] n: Int }
	type Thing { id: ID! }
	type Query { things(ids: [ID!]): [Thing!]!  m(rows: [[String!]!]!): Int }
	type Mutation { tag(input: TagFilter!): Thing! }
`);

const ctx = { context: {} };
const call = (name: string, input: unknown) => ({
	type: 'tool-call' as const,
	id: 'c1',
	name,
	input,
});

const tools = () =>
	graphqlTools({
		schema,
		operations: [
			{
				name: 'things',
				description: 'Reads things',
				document: 'query Q($ids: [ID!]) { things(ids: $ids) { id } }',
				variables: zThingsQueryVariables,
			},
			{
				name: 'tag',
				description: 'Tags',
				document:
					'mutation M($input: TagFilter!) { tag(input: $input) { id } }',
				variables: zTagMutationVariables,
			},
			{
				name: 'matrix',
				description: 'Rows',
				document: 'query X($rows: [[String!]!]!) { m(rows: $rows) }',
				variables: zMatrixVariables,
			},
		],
	});

const byName = (name: string) => {
	const tool = tools().find((t) => t.name === name);
	if (!tool) throw new Error(name);
	return tool;
};

describe('graphqlTools: list variables', () => {
	it('builds, with the list as a JSON Schema array of typed items', () => {
		const schemaOf = byName('things').inputSchema as unknown as {
			properties: { ids: unknown };
		};
		expect(schemaOf.properties.ids).toEqual({
			anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
		});
	});

	it('validates the items of the array', () => {
		const tool = byName('things');
		expect(tool.validate({ ids: ['a'] })).toEqual({
			ok: true,
			value: { ids: ['a'] },
		});
		expect(tool.validate({}).ok).toBe(true);
		expect(tool.validate({ ids: [1] }).ok).toBe(false);
	});

	it('handles an input object holding a list', () => {
		const tool = byName('tag');
		const json = JSON.stringify(tool.inputSchema);
		expect(json).toContain('"tags"');
		expect(json).not.toContain('"items":{}');
		expect(tool.validate({ input: { tags: ['x'], n: 1 } }).ok).toBe(true);
		expect(tool.validate({ input: { tags: [2] } }).ok).toBe(false);
	});

	it('handles lists of lists', () => {
		const tool = byName('matrix');
		expect(tool.inputSchema['properties']).toEqual({
			rows: {
				type: 'array',
				items: { type: 'array', items: { type: 'string' } },
			},
		});
		expect(tool.validate({ rows: [['a'], ['b']] }).ok).toBe(true);
		expect(tool.validate({ rows: [[1]] }).ok).toBe(false);
	});

	it('runs a tool whose variables hold a list', async () => {
		const out = await executeTool(
			byName('matrix'),
			call('matrix', { rows: [['a']] }),
			ctx,
		);
		expect(out).toBeDefined();
	});

	it('still refuses any other unrepresentable schema', () => {
		expect(() =>
			graphqlTools({
				schema,
				operations: [
					{
						name: 'bad',
						description: 'Bad',
						document: '{ m(rows: []) }',
						variables: z.object({ when: z.date() }),
					},
				],
			}),
		).toThrow(expect.objectContaining({ code: 'INVALID_OPERATION' }));
	});

	it('refuses an unrepresentable item inside a list', () => {
		expect(() =>
			graphqlTools({
				schema,
				operations: [
					{
						name: 'bad',
						description: 'Bad',
						document: '{ m(rows: []) }',
						variables: z.object({ d: zDateList }),
					},
				],
			}),
		).toThrow(expect.objectContaining({ code: 'INVALID_OPERATION' }));
	});

	it('refuses a custom schema that is not a list coercion', () => {
		expect(() =>
			graphqlTools({
				schema,
				operations: [
					{
						name: 'bad',
						description: 'Bad',
						document: '{ m(rows: []) }',
						variables: z.object({ x: z.custom<string>() }),
					},
				],
			}),
		).toThrow(expect.objectContaining({ code: 'INVALID_OPERATION' }));
	});
});

describe('graphqlTools: variables written by the real codegen-zod plugin', () => {
	it('builds and validates a list query and a mutation with a list input', async () => {
		const rawSDL = `query Q($ids: [ID!]) { things(ids: $ids) { id } }
mutation M($input: TagFilter!) { tag(input: $input) { id } }`;
		const out = await (
			zodPlugin as unknown as {
				plugin(...args: unknown[]): Promise<string | { content: string }>;
			}
		).plugin(
			schema,
			[
				{
					location: 'ops.graphql',
					rawSDL,
					document: parse(rawSDL, { noLocation: true }),
				},
			],
			{},
			{ outputFile: 'zod.ts' },
		);
		const code = typeof out === 'string' ? out : out.content;
		{
			// Inside the package so `zod` resolves.
			const file = join(import.meta.dir, `.lists-${Date.now()}.gen.ts`);
			writeFileSync(file, code);
			try {
				const gen = await import(file);
				const [things, tag] = graphqlTools({
					schema,
					operations: [
						{
							name: 'things',
							description: 'Reads things',
							document: rawSDL.split('\n')[0] as string,
							variables: gen.zQQueryVariables,
						},
						{
							name: 'tag',
							description: 'Tags',
							document: rawSDL.split('\n')[1] as string,
							variables: gen.zMMutationVariables,
						},
					],
				});
				expect(things?.validate({ ids: ['a'] }).ok).toBe(true);
				expect(things?.validate({ ids: [1] }).ok).toBe(false);
				expect(tag?.validate({ input: { tags: ['a'] } }).ok).toBe(true);
				expect(tag?.validate({ input: { tags: [1] } }).ok).toBe(false);
			} finally {
				rmSync(file, { force: true });
			}
		}
	});
});
