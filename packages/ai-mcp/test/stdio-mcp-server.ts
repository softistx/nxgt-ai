import { mcpServer } from '../src/server';
import { safeTools } from './server-tools';

await mcpServer({
	tools: safeTools(),
	name: 'stdio-fixture',
	version: '1.0.0',
	context: () => ({ viewer: 'stdio-user' }),
}).stdio();
