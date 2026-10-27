// Type tests: what `execute` is given and what the types refuse. A wrong
// expectation fails `bun run typecheck`, not the run.
import { expectTypeOf, test } from 'bun:test';
import { z } from 'zod';
import {
	defineTool,
	jsonSchemaTool,
	type Tool,
	type ToolContext,
} from './index';

test('execute is typed from the input schema', () => {
	defineTool({
		name: 'search',
		description: 'Search',
		input: z.object({
			query: z.string(),
			limit: z.number().default(10),
			tags: z.array(z.string()).optional(),
			kind: z.enum(['a', 'b']),
		}),
		execute: (input, tool) => {
			expectTypeOf(input.query).toEqualTypeOf<string>();
			expectTypeOf(input.limit).toEqualTypeOf<number>();
			expectTypeOf(input.tags).toEqualTypeOf<string[] | undefined>();
			expectTypeOf(input.kind).toEqualTypeOf<'a' | 'b'>();
			expectTypeOf(tool.signal).toEqualTypeOf<AbortSignal>();
			expectTypeOf(tool.context).toBeUnknown();
			return null;
		},
	});
});

test('the context type follows an annotation on execute', () => {
	const tool = defineTool({
		name: 'me',
		description: 'Who am I',
		input: z.object({}),
		execute: (_input, { context }: ToolContext<{ userId: string }>) =>
			context.userId,
	});
	expectTypeOf<Parameters<typeof tool.execute>[1]>().toEqualTypeOf<
		ToolContext<{ userId: string }>
	>();
});

test('an output schema types the return value and the tool output', () => {
	const tool = defineTool({
		name: 'count',
		description: 'Count',
		input: z.object({ q: z.string() }),
		output: z.object({ total: z.number() }),
		execute: () => ({ total: 3 }),
	});
	expectTypeOf<typeof tool>().toExtend<
		Tool<{ q: string }, { total: number }, unknown>
	>();
	defineTool({
		name: 'count',
		description: 'Count',
		input: z.object({}),
		output: z.object({ total: z.number() }),
		// @ts-expect-error — the return value must match the output schema
		execute: () => ({ total: 'three' }),
	});
});

// Never called: the refusals are for the compiler, and some would throw.
const refusals = () => {
	defineTool({
		name: 'a',
		description: 'a',
		input: z.object({ n: z.number() }),
		execute: (input) => {
			// @ts-expect-error — `n` is a number, not a string
			const text: string = input.n;
			// @ts-expect-error — the schema has no such field
			input.missing;
			return text;
		},
	});
	// @ts-expect-error — a tool needs its description
	defineTool({ name: 'a', input: z.object({}), execute: () => 1 });
	const plain = { n: 'number' };
	// @ts-expect-error — the input is a Zod schema, not a plain object
	defineTool({ name: 'a', description: 'a', input: plain, execute: () => 1 });
};
test('the refusals compile as refusals', () => {
	expectTypeOf(refusals).toBeFunction();
});

test('jsonSchemaTool takes its input type from the type argument', () => {
	jsonSchemaTool<{ id: string }>({
		name: 'a',
		description: 'a',
		inputSchema: { type: 'object' },
		execute: (input) => {
			expectTypeOf(input.id).toEqualTypeOf<string>();
		},
	});
	jsonSchemaTool({
		name: 'a',
		description: 'a',
		inputSchema: { type: 'object' },
		execute: (input) => {
			expectTypeOf(input).toBeUnknown();
		},
	});
});
