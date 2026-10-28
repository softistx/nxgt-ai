import { describe, expect, it } from 'bun:test';
import { executeTool } from '@nxgt/ai-core';
import { mcpTools } from './client';

const script = new URL('../test/stdio-mcp-server.ts', import.meta.url).pathname;

describe('mcpServer().stdio', () => {
	it('serves a spawned process to the client', async () => {
		const { tools, close } = await mcpTools({
			transport: { type: 'stdio', command: process.execPath, args: [script] },
			include: ['echo', 'whoami'],
		});
		try {
			const run = (name: string, input: unknown) => {
				const tool = tools.find((t) => t.name === name);
				if (!tool) throw new Error('no tool');
				return executeTool(tool, { type: 'tool-call', id: 'c', name, input });
			};
			expect(await run('echo', { text: 'stdio' })).toMatchObject({
				isError: false,
				output: { structuredContent: { echoed: 'stdio' } },
			});
			expect(await run('whoami', {})).toMatchObject({
				output: { structuredContent: { viewer: { viewer: 'stdio-user' } } },
			});
		} finally {
			await close();
		}
	});
});
