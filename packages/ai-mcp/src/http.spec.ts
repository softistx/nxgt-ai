import { afterAll, describe, expect, it } from 'bun:test';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { executeTool } from '@nxgt/ai-core';
import { createTestServer } from '../test/server';
import { mcpTools } from './client';

// Stateless: a server and a transport per request.
const http = Bun.serve({
	port: 0,
	async fetch(request) {
		if (request.headers.get('authorization') !== 'Bearer t0ken') {
			return new Response('no', { status: 401 });
		}
		const transport = new WebStandardStreamableHTTPServerTransport({
			enableJsonResponse: true,
		});
		await createTestServer().connect(transport);
		return transport.handleRequest(request);
	},
});
afterAll(() => http.stop(true));

describe('mcpTools over Streamable HTTP', () => {
	it('lists and calls with the configured headers', async () => {
		const { tools, close } = await mcpTools({
			transport: {
				type: 'http',
				url: `http://localhost:${http.port}/mcp`,
				headers: { authorization: 'Bearer t0ken' },
			},
			include: ['echo'],
		});
		const echo = tools[0];
		if (!echo) throw new Error('no tool');
		const out = await executeTool(echo, {
			type: 'tool-call',
			id: 'c',
			name: 'echo',
			input: { text: 'over http' },
		});
		expect(out).toMatchObject({
			isError: false,
			output: { content: [{ type: 'text', text: 'echo:over http' }] },
		});
		await close();
	});

	it('throws MCP_UNAVAILABLE without the credentials', async () => {
		const error = await mcpTools({
			transport: { type: 'http', url: `http://localhost:${http.port}/mcp` },
		}).catch((e) => e);
		expect(error).toMatchObject({ code: 'MCP_UNAVAILABLE' });
	});
});
