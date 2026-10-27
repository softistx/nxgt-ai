import { generate, type Message, type ModelAdapter } from '@nxgt/ai-core';

export interface SummarizeOptions {
	/** The instruction to the model; the default asks for a faithful brief summary. */
	system?: string;
	/** Cap on the summary, in tokens; default 1024. */
	maxTokens?: number;
	signal?: AbortSignal;
}

const SYSTEM =
	'Summarise the conversation so far for the assistant that will continue it. ' +
	'Keep facts, decisions, names, identifiers and open questions; drop pleasantries. ' +
	'Reply with the summary only, in the language of the conversation.';

/** A `summarize` for `compact`, backed by a model through `generate`. */
export function summarizeWith(
	model: ModelAdapter,
	options: SummarizeOptions = {},
): (messages: Message[]) => Promise<string> {
	return async (messages) => {
		const { message } = await generate(
			model,
			{
				system: [{ text: options.system ?? SYSTEM }],
				messages: [
					{
						role: 'user',
						parts: [{ type: 'text', text: transcript(messages) }],
					},
				],
				maxTokens: options.maxTokens ?? 1024,
				cache: 'off',
			},
			options.signal,
		);
		return message.parts
			.flatMap((p) => (p.type === 'text' ? [p.text] : []))
			.join('')
			.trim();
	};
}

/** The messages as plain text: a model summarises text, not tool calls. */
function transcript(messages: readonly Message[]): string {
	return messages
		.map((m) => {
			const body = m.parts
				.map((p) => {
					if (p.type === 'text') return p.text;
					if (p.type === 'tool-call') return `[called ${p.name}]`;
					if (p.type === 'tool-result') {
						const out = p.isError ? p.error.message : JSON.stringify(p.output);
						return `[result of ${p.name}: ${out}]`;
					}
					return '';
				})
				.filter(Boolean)
				.join('\n');
			return `${m.role}: ${body}`;
		})
		.join('\n\n');
}
