import type { Message, Part } from '@nxgt/ai-core';
import type { StoredMessage } from './types';

/** What replaces the output of a tool result that was cut. */
export interface TruncatedOutput {
	truncated: true;
	/** The size of the original output, serialised, in characters. */
	originalChars: number;
	/** The start of the original output, serialised. */
	preview: string;
}

export function isTruncated(output: unknown): output is TruncatedOutput {
	return (
		typeof output === 'object' &&
		output !== null &&
		(output as { truncated?: unknown }).truncated === true
	);
}

/** The part with its output cut to `max` characters, or undefined when it fits. */
export function truncatePart(part: Part, max: number): Part | undefined {
	if (part.type !== 'tool-result' || part.isError || isTruncated(part.output)) {
		return undefined;
	}
	const json = JSON.stringify(part.output) ?? '';
	if (json.length <= max) return undefined;
	const output: TruncatedOutput = {
		truncated: true,
		originalChars: json.length,
		preview: json.slice(0, max),
	};
	return { ...part, output };
}

/** The message with the tool result at `index` cut, or undefined when it fits. */
export function truncateAt(
	m: StoredMessage,
	index: number,
	max: number,
): StoredMessage | undefined {
	const part = m.message.parts[index];
	const cut = part && truncatePart(part, max);
	if (!cut) return undefined;
	const parts = m.message.parts.map((p, i) => (i === index ? cut : p));
	return { ...m, message: { ...m.message, parts } };
}

export const plain = (messages: readonly StoredMessage[]): Message[] =>
	messages.map((m) => m.message);
