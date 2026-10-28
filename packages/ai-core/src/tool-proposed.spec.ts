import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { ProposedActionPart } from './message';
import { runToolCalls, type ToolRunContext } from './run-tools';
import { defineTool } from './tool';

const call = {
	type: 'tool-call' as const,
	id: 'c1',
	name: 'act',
	input: {},
};

async function proposedFlags(confirm: boolean): Promise<boolean[]> {
	const tool = defineTool({
		name: 'act',
		description: 'Acts',
		input: z.object({}),
		confirm,
		execute: () => ({}),
	});
	const flags: boolean[] = [];
	const run: ToolRunContext = {
		tools: new Map([[tool.name, tool]]),
		context: undefined,
		signal: new AbortController().signal,
		step: 0,
		runId: 'r',
		ttlMs: 10,
		now: () => 0,
		proposals: [] as ProposedActionPart[],
		observers: [{ onToolCall: ({ proposed }) => void flags.push(proposed) }],
		emit: () => {},
	};
	await runToolCalls([call], run);
	return flags;
}

describe('onToolCall proposed', () => {
	test('is true for a confirm tool and false for a normal one', async () => {
		expect(await proposedFlags(true)).toEqual([true]);
		expect(await proposedFlags(false)).toEqual([false]);
	});
});
