import { defineTool } from '@nxgt/ai-core';
import { z } from 'zod';

export const SECRET = 'SECRET-internal-detail';

export interface ServerSeen {
	aborted: boolean;
	started: boolean;
}

/** Tools for the server specs; `seen` records what the slow tool saw. */
export function serverTools(
	seen: ServerSeen = { aborted: false, started: false },
) {
	return [
		defineTool({
			name: 'echo',
			description: 'Repeats the text',
			input: z.object({ text: z.string().describe('What to repeat') }),
			execute: ({ text }) => ({ echoed: text }),
		}),
		defineTool({
			name: 'whoami',
			description: 'Returns the viewer of the context',
			input: z.object({}),
			execute: (_input, { context }) => ({ viewer: context }),
		}),
		defineTool({
			name: 'explode',
			description: 'Always throws',
			input: z.object({}),
			execute: () => {
				throw new Error(SECRET);
			},
		}),
		defineTool({
			name: 'slow',
			description: 'Waits for an abort',
			input: z.object({}),
			execute: async (_input, { signal }) => {
				seen.started = true;
				await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, 5000);
					signal.addEventListener('abort', () => {
						seen.aborted = true;
						clearTimeout(timer);
						resolve();
					});
				});
				return 'late';
			},
		}),
		defineTool({
			name: 'delete_all',
			description: 'A mutation',
			input: z.object({}),
			confirm: true,
			execute: () => 'deleted',
		}),
	];
}

/** The tools that are not `confirm: true`. */
export const safeTools = (seen?: ServerSeen) =>
	serverTools(seen).filter((t) => !t.confirm);
