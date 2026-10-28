import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTestServer } from './server';

await createTestServer().connect(new StdioServerTransport());
