import { describe, expect, it } from 'bun:test';
import { executeTool } from '@nxgt/ai-core';
import { z } from 'zod';
import { build1, call } from '../test/helpers';
import type { GraphqlOperation } from './index';

describe('graphqlTools: truncation', () => {
	const list: GraphqlOperation = {
		name: 'list_books',
		description: 'Lists books',
		document: 'query L($limit: Int) { books(limit: $limit) { id title } }',
		variables: z.object({ limit: z.number().int().optional() }),
	};

	it('cuts a long result and says so', async () => {
		const tool = build1([list], { maxResultChars: 400 });
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
		expect(JSON.stringify(o).length).toBeLessThanOrEqual(400);
		expect(o.preview.length).toBeGreaterThan(0);
		expect(o.originalChars).toBeGreaterThan(400);
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

describe('graphqlTools: truncation bound', () => {
	const bound = async (max: number, data: unknown) => {
		const { fitOutput } = await import('./result');
		return JSON.stringify(fitOutput({ data }, max)).length;
	};

	it('keeps the whole marker within maxResultChars, whatever the max', async () => {
		const quotes = { q: '"\\"'.repeat(500) };
		for (const max of [100, 150, 300, 1000]) {
			expect(await bound(max, quotes)).toBeLessThanOrEqual(max);
		}
	});

	it('fails with INTERNAL_ERROR on data JSON cannot hold', async () => {
		const { fitOutput } = await import('./result');
		expect(() => fitOutput({ data: { n: 1n } }, 100)).toThrow();
	});
});
