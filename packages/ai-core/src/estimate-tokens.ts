import type { Message, Part } from './message';

const CHARS_PER_TOKEN = 4;

function partText(part: Part): string {
	switch (part.type) {
		case 'text':
		case 'thinking':
			return part.text;
		case 'tool-call':
			return `${part.name}${JSON.stringify(part.input) ?? ''}`;
		case 'tool-result':
			return part.isError
				? part.error.message
				: (JSON.stringify(part.output) ?? '');
		case 'proposed-action':
			return `${part.tool}${JSON.stringify(part.input) ?? ''}${part.summary ?? ''}`;
	}
}

/**
 * A rough token count with no tokenizer: the characters of the text, or of
 * every part of the messages, divided by 4 and rounded up. It is good enough
 * to size a context or pick what to compact, within about 30% for English and
 * French prose, and it under-counts code and CJK text. For a budget, prefer
 * the provider's last reported `Usage` plus the estimate of what was added
 * since.
 */
export function estimateTokens(input: string | readonly Message[]): number {
	const chars =
		typeof input === 'string'
			? input.length
			: input.reduce(
					(sum, m) => sum + m.parts.reduce((n, p) => n + partText(p).length, 0),
					0,
				);
	return Math.ceil(chars / CHARS_PER_TOKEN);
}
