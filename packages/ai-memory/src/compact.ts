import { estimateTokens, type Message } from '@nxgt/ai-core';
import { MemoryError } from './errors';
import { userCut } from './pairs';
import { plain, truncateAt } from './truncate';
import type { StoredMessage } from './types';

export interface CompactOptions {
	/** The most tokens the summary and the messages may take together. */
	budget: number;
	/** The newest messages a fold never touches; default 6. */
	keepLast?: number;
	/** Longest serialised tool output kept, in characters; default 2000. */
	truncateToolResultsTo?: number;
	/** Writes the summary of the messages to fold; the previous one comes first. */
	summarize: (messages: Message[]) => Promise<string>;
	/** The summary already stored for the thread, folded into the next one. */
	summary?: { text: string };
	/** Default: `estimateTokens` of `@nxgt/ai-core`. */
	estimate?: (input: string | readonly Message[]) => number;
}

export interface CompactResult {
	/** The new summary; absent when nothing was folded by this call. */
	summary?: string;
	/** The last message the new summary covers; store it with `setSummary`. */
	throughMessageId?: string;
	/** What to send to the model after the summary. */
	messages: StoredMessage[];
	/** Estimated tokens of the kept summary and `messages`. */
	tokens: number;
}

/**
 * Brings a thread under `budget`: first it cuts the tool results, oldest
 * first; if that is not enough it folds the oldest messages into a rolling
 * summary. A tool call and its result stay together, and the kept messages
 * start on a user turn when the thread has one before the cut. Throws
 * `MemoryError` `EMPTY_SUMMARY` when `summarize` returns blank text. `messages` are the
 * thread's messages after its stored summary (`load` with `sinceSummary`).
 */
export async function compact(
	messages: readonly StoredMessage[],
	options: CompactOptions,
): Promise<CompactResult> {
	const { budget, summarize, summary } = options;
	const keepLast = Math.max(0, options.keepLast ?? 6);
	const estimate = options.estimate ?? estimateTokens;
	const size = (list: readonly StoredMessage[], text?: string) =>
		estimate(plain(list)) + (text ? estimate(text) : 0);

	const cut = cutResults(
		messages,
		options.truncateToolResultsTo ?? 2000,
		(list) => size(list, summary?.text) <= budget,
	);
	const kept = cut.length - keepLast;
	const at = size(cut, summary?.text) <= budget ? 0 : userCut(cut, kept);
	if (at === 0) return { messages: cut, tokens: size(cut, summary?.text) };

	const folded = cut.slice(0, at);
	const previous: Message[] = summary
		? [
				{
					role: 'user',
					parts: [{ type: 'text', text: `Summary so far:\n${summary.text}` }],
				},
			]
		: [];
	const text = await summarize([...previous, ...plain(folded)]);
	if (text.trim() === '') {
		throw new MemoryError(
			'EMPTY_SUMMARY',
			'summarize returned an empty summary; nothing was folded.',
		);
	}
	const tail = cut.slice(at);
	return {
		summary: text,
		throughMessageId: (folded[folded.length - 1] as StoredMessage).id,
		messages: tail,
		tokens: size(tail, text),
	};
}

/** Cuts tool results oldest first until `fits` says the list is small enough. */
function cutResults(
	messages: readonly StoredMessage[],
	max: number,
	fits: (list: readonly StoredMessage[]) => boolean,
): StoredMessage[] {
	const out = [...messages];
	for (let i = 0; i < out.length && !fits(out); i++) {
		const parts = (out[i] as StoredMessage).message.parts;
		for (let j = 0; j < parts.length; j++) {
			const next = truncateAt(out[i] as StoredMessage, j, max);
			if (next) out[i] = next;
		}
	}
	return out;
}
