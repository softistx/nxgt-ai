import type { StoredMessage } from './types';

/**
 * The first index a fold may keep from: `from`, moved back until no kept tool
 * result answers a tool call that the fold would swallow. A call is always
 * before its result, so this is the only way to split a pair.
 */
export function safeCut(messages: readonly StoredMessage[], from: number) {
	let cut = Math.max(0, Math.min(from, messages.length));
	while (cut > 0 && splitsPair(messages, cut)) cut--;
	return cut;
}

function splitsPair(messages: readonly StoredMessage[], cut: number): boolean {
	const folded = new Set<string>();
	for (const m of messages.slice(0, cut)) {
		for (const p of m.message.parts)
			if (p.type === 'tool-call') folded.add(p.id);
	}
	return messages
		.slice(cut)
		.some((m) =>
			m.message.parts.some(
				(p) => p.type === 'tool-result' && folded.has(p.callId),
			),
		);
}
