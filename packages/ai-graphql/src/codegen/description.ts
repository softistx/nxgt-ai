import type { OperationDefinitionNode } from 'graphql';
import { fail } from './config';

const TOOL_COMMENT = /^#\s*tool:\s*(.*)$/;

/** A `# tool:` comment block directly above `start`, joined into one line. */
export function toolComment(body: string, start: number): string | undefined {
	const lines = body.slice(0, start).split(/\r\n|\r|\n/);
	lines.pop(); // the text before the operation on its own line
	const block: string[] = [];
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = (lines[i] ?? '').trim();
		if (!line.startsWith('#')) break;
		block.unshift(line);
	}
	const first = block.findIndex((l) => TOOL_COMMENT.test(l));
	if (first === -1) return undefined;
	const text = block
		.slice(first)
		.map((l, i) =>
			(i === 0
				? (TOOL_COMMENT.exec(l)?.[1] ?? '')
				: l.replace(/^#\s?/, '')
			).trim(),
		)
		.filter(Boolean)
		.join(' ');
	return text || undefined;
}

/** The operation's description: graphql 17 syntax, else the `# tool:` comment. */
export function describe(
	node: OperationDefinitionNode,
	body: string | undefined,
	name: string,
): string {
	const own = (node as { description?: { value: string } }).description;
	if (own?.value.trim()) return own.value.trim();
	const start = node.loc?.start;
	if (body !== undefined && start !== undefined) {
		const comment = toolComment(body, start);
		if (comment) return comment;
	}
	return fail(
		`operation "${name}" has no description. Describe it with a """description""" above it (graphql 17) or a "# tool: …" comment directly above it: the model reads it to choose the tool.`,
	);
}
