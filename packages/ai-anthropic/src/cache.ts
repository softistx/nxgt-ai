export type Block = Record<string, unknown>;

const EPHEMERAL = { type: 'ephemeral' } as const;

/**
 * Places prompt-cache breakpoints, at most three of the four the API allows:
 * the last tool, the last system block and the last block of the last user
 * message (the stable prefix grows by one turn each call, so the next call
 * reads this one). A breakpoint caches everything before it.
 */
export function placeBreakpoints(parts: {
	tools?: Block[] | undefined;
	system?: Block[] | undefined;
	messages: Array<{ role: string; content: Block[] }>;
}): void {
	const mark = (block: Block | undefined) => {
		if (block) block['cache_control'] = EPHEMERAL;
	};
	mark(parts.tools?.at(-1));
	mark(parts.system?.at(-1));
	const lastUser = parts.messages.findLast((m) => m.role === 'user');
	mark(lastUser?.content.at(-1));
}
