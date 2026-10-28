import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { ProposedActionPart } from './message';
import { runToolCalls, type ToolRunContext } from './run-tools';
import type { AnyTool } from './tool';
import { defineTool, jsonSchemaTool } from './tool';

function setup(tool: AnyTool) {
	const proposals: ProposedActionPart[] = [];
	const run: ToolRunContext = {
		tools: new Map([[tool.name, tool]]),
		context: undefined,
		signal: new AbortController().signal,
		step: 0,
		runId: 'r',
		ttlMs: 10,
		now: () => 0,
		proposals,
		observers: undefined,
		emit: () => {},
	};
	return { run, proposals };
}
const call = {
	type: 'tool-call' as const,
	id: 'c1',
	name: 'pay',
	input: { invoice: 'A1' },
};
const base = {
	name: 'pay',
	description: 'Pays',
	input: z.object({ invoice: z.string() }),
	confirm: true,
	execute: () => 'ok',
};

describe('summarize', () => {
	test('fills the summary of the proposed action', async () => {
		const tool = defineTool({
			...base,
			summarize: ({ invoice }) => `Pay invoice ${invoice}`,
		});
		const { run, proposals } = setup(tool);
		await runToolCalls([call], run);
		expect(proposals[0]?.summary).toBe('Pay invoice A1');
	});

	test('a tool without summarize keeps no summary', async () => {
		const { run, proposals } = setup(defineTool(base));
		await runToolCalls([call], run);
		expect(proposals).toHaveLength(1);
		expect('summary' in (proposals[0] ?? {})).toBe(false);
	});

	test('a throwing summarize leaves the summary out and the proposal stands', async () => {
		const tool = defineTool({
			...base,
			summarize: () => {
				throw new Error('boom');
			},
		});
		const { run, proposals } = setup(tool);
		const [result] = await runToolCalls([call], run);
		expect(result).toMatchObject({
			isError: false,
			output: { status: 'pending' },
		});
		expect(proposals).toHaveLength(1);
		expect('summary' in (proposals[0] ?? {})).toBe(false);
	});

	test('an empty summary is left out', async () => {
		const { run, proposals } = setup(
			defineTool({ ...base, summarize: () => '  ' }),
		);
		await runToolCalls([call], run);
		expect(proposals[0]?.summary).toBeUndefined();
	});

	test('jsonSchemaTool takes summarize too', async () => {
		const tool = jsonSchemaTool({
			name: 'pay',
			description: 'Pays',
			inputSchema: { type: 'object', properties: {} },
			confirm: true,
			summarize: () => 'Pay',
			execute: () => 1,
		});
		const { run, proposals } = setup(tool);
		await runToolCalls([call], run);
		expect(proposals[0]?.summary).toBe('Pay');
	});
});
