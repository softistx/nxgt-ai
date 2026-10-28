import { afterAll, describe, expect, it } from 'bun:test';
import { executeTool } from '@nxgt/ai-core';
import { type ServerSeen, safeTools } from '../test/server-tools';
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

	it('answers GET and DELETE with 405 and Allow: POST', async () => {
		for (const method of ['GET', 'DELETE']) {
			const response = await fetch(`http://localhost:${http.port}/mcp`, {
				method,
			});
			expect(response.status).toBe(405);
			expect(response.headers.get('allow')).toBe('POST');
		}
	});

	it('refuses a JSON-RPC batch with 400 and a JSON-RPC error', async () => {
		const response = await fetch(`http://localhost:${http.port}/mcp`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
			},
			body: JSON.stringify([
				{ jsonrpc: '2.0', id: 1, method: 'tools/list' },
				{ jsonrpc: '2.0', id: 2, method: 'tools/list' },
			]),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			jsonrpc: '2.0',
			error: { code: -32600 },
			id: null,
		});
	});

	it('answers 413 for a body over 4 MiB, declared or streamed', async () => {
		const big = 'x'.repeat(4 * 1024 * 1024 + 1);
		const declared = await fetch(`http://localhost:${http.port}/mcp`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: big,
		});
		expect(declared.status).toBe(413);
		const streamed = await server.fetch(
			new Request('http://localhost/mcp', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(big));
						controller.close();
					},
				}),
				duplex: 'half',
			} as RequestInit),
		);
		expect(streamed.status).toBe(413);
	});

	it('aborts the tool when the HTTP client disconnects', async () => {
		const seen: ServerSeen = { aborted: false, started: false };
		const slow = mcpServer({
			tools: safeTools(seen),
			name: 'slow',
			version: '1.0.0',
		});
		const listener = Bun.serve({
			port: 0,
			fetch: (request) => slow.fetch(request),
		});
		try {
			const controller = new AbortController();
			const pending = fetch(`http://localhost:${listener.port}/mcp`, {
				method: 'POST',
				signal: controller.signal,
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: 'slow', arguments: {} },
				}),
			});
			pending.catch(() => {});
			const wait = async (flag: () => boolean) => {
				const deadline = Date.now() + 3000;
				while (!flag() && Date.now() < deadline) await Bun.sleep(10);
			};
			await wait(() => seen.started);
			expect(seen.started).toBe(true);
			controller.abort();
			await wait(() => seen.aborted);
			expect(seen.aborted).toBe(true);
		} finally {
			await listener.stop(true);
		}
	});

	it('answers TOOL_TIMEOUT over fetch when timeoutMs passes', async () => {
		const limited = mcpServer({
			tools: safeTools(),
			name: 'limited',
			version: '1.0.0',
			timeoutMs: 50,
		});
		const response = await limited.fetch(
			new Request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: 'slow', arguments: {} },
				}),
			}),
		);
		expect(JSON.stringify(await response.json())).toContain('TOOL_TIMEOUT');
	});
});
