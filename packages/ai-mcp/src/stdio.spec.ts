import { afterAll, describe, expect, it } from 'bun:test';
import { executeTool } from '@nxgt/ai-core';
import { mcpTools } from './client';

const script = new URL('../test/stdio-server.ts', import.meta.url).pathname;

describe('mcpTools over stdio', () => {
	const closers: (() => Promise<void>)[] = [];
	afterAll(async () => {
		await Promise.all(closers.map((c) => c()));
	});

	it('spawns a server, lists, calls and closes', async () => {
		const { tools, close } = await mcpTools({
			transport: { type: 'stdio', command: process.execPath, args: [script] },
			include: ['echo', 'fail'],
		});
		closers.push(close);
		expect(tools.map((t) => t.name)).toEqual(['echo', 'fail']);
		const echo = tools[0];
		if (!echo) throw new Error('no tool');
		const out = await executeTool(echo, {
			type: 'tool-call',
			id: 'c',
			name: 'echo',
			input: { text: 'over stdio' },
		});
		expect(out).toMatchObject({
			isError: false,
			output: { content: [{ type: 'text', text: 'echo:over stdio' }] },
		});
		await close();
	});
});
