import { afterAll, describe, expect, it } from 'bun:test';
import { executeTool } from '@nxgt/ai-core';
import { safeTools } from '../test/server-tools';
import { mcpTools } from './client';
import { mcpServer } from './server';

const server = mcpServer({
	tools: safeTools(),
	name: 'http-fixture',
	version: '1.0.0',
	context: ({ request }) => ({
		viewer: request?.headers.get('x-viewer') ?? 'anonymous',
	}),
});
const http = Bun.serve({ port: 0, fetch: (request) => server.fetch(request) });
afterAll(() => http.stop(true));

const connect = (viewer: string) =>
	mcpTools({
		transport: {
			type: 'http',
			url: `http://localhost:${http.port}/mcp`,
			headers: { 'x-viewer': viewer },
		},
	});

const run = async (
	tools: Awaited<ReturnType<typeof connect>>['tools'],
	name: string,
	input: unknown = {},
) => {
	const tool = tools.find((t) => t.name === name);
	if (!tool) throw new Error(`no tool ${name}`);
	return executeTool(tool, { type: 'tool-call', id: 'c', name, input });
};

describe('mcpServer().fetch over Streamable HTTP', () => {
	it('lists and calls through Bun.serve', async () => {
		const { tools, close } = await connect('ann');
		try {
			expect(tools.map((t) => t.name)).toEqual(safeTools().map((t) => t.name));
			expect(await run(tools, 'echo', { text: 'over http' })).toMatchObject({
				isError: false,
				output: { structuredContent: { echoed: 'over http' } },
			});
		} finally {
			await close();
		}
	});

	it('builds the context from each request', async () => {
		const a = await connect('ann');
		const b = await connect('bob');
		try {
			const whoA = await run(a.tools, 'whoami');
			const whoB = await run(b.tools, 'whoami');
			expect(whoA).toMatchObject({
				output: { structuredContent: { viewer: { viewer: 'ann' } } },
			});
			expect(whoB).toMatchObject({
				output: { structuredContent: { viewer: { viewer: 'bob' } } },
			});
		} finally {
			await a.close();
			await b.close();
		}
	});

	it('answers a failing tool with a code only', async () => {
		const { tools, close } = await connect('ann');
		try {
			const out = await run(tools, 'explode');
			expect(out).toMatchObject({ isError: true });
			expect(JSON.stringify(out)).not.toContain('SECRET');
		} finally {
			await close();
		}
	});
});
