import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpClientError } from './errors';
import type { McpToolsOptions } from './options';

export function createTransport(t: McpToolsOptions['transport']): Transport {
	switch (t.type) {
		case 'stdio':
			return new StdioClientTransport({
				command: t.command,
				...(t.args ? { args: [...t.args] } : {}),
				...(t.env ? { env: { ...t.env } } : {}),
				...(t.cwd ? { cwd: t.cwd } : {}),
			});
		case 'http':
			return new StreamableHTTPClientTransport(
				typeof t.url === 'string' ? new URL(t.url) : t.url,
				t.headers ? { requestInit: { headers: { ...t.headers } } } : {},
			);
		case 'transport':
			return t.transport;
		default:
			throw new McpClientError(
				'INVALID_OPTIONS',
				'transport.type must be "stdio", "http" or "transport".',
			);
	}
}
