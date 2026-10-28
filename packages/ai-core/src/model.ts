import type { Message, Usage } from './message';
import type { ToolSpec } from './tool';

/** Why one model call stopped. */
export type FinishReason = 'end' | 'tool-use' | 'max-tokens' | 'refusal';

/** One system prompt block; a cache-aware adapter may cache each block. */
export interface SystemBlock {
	text: string;
}

/** Extended thinking; an adapter ignores it when its model has none. */
export interface ThinkingOptions {
	/** Tokens the model may spend thinking (a fixed budget). */
	budgetTokens?: number;
	/**
	 * `'budget'` thinks within `budgetTokens`; `'adaptive'` lets the model
	 * decide when and how much to think. Default: `'budget'`, or no thinking
	 * switch at all when only `effort` is set.
	 */
	mode?: 'budget' | 'adaptive';
	/** How much the model works: thinking depth and overall token spend. */
	effort?: ThinkingEffort;
	/** `'summarized'` returns a readable summary of the thinking, `'omitted'` returns none. */
	display?: 'summarized' | 'omitted';
}

/** The effort levels of a model that has them. */
export type ThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelRequest {
	system?: readonly SystemBlock[];
	messages: readonly Message[];
	tools?: readonly ToolSpec[];
	maxTokens?: number;
	temperature?: number;
	/** `'auto'` (default) lets the adapter place prompt-cache breakpoints. */
	cache?: 'auto' | 'off';
	thinking?: ThinkingOptions;
	/** Passed to the adapter as is, for what the port does not model. */
	providerOptions?: Record<string, unknown>;
}

/** What a model adapter streams. A call ends with exactly one `finish`. */
export type ModelEvent =
	| {
			type: 'text-delta';
			text: string;
			/** Opens a new part even when the last one has the same type. */
			start?: true;
	  }
	| {
			type: 'thinking-delta';
			text: string;
			/** Opens a new part: two consecutive blocks keep their signatures. */
			start?: true;
			signature?: string;
			/** An opaque redacted block: becomes its own part, `text` is empty. */
			redacted?: string;
	  }
	| { type: 'tool-call'; id: string; name: string; input: unknown }
	| { type: 'usage'; usage: Usage }
	| { type: 'finish'; reason: FinishReason };

/**
 * The port every provider implements. `stream` throws an `AiError`
 * (`MODEL_ERROR`, `RATE_LIMITED`, `AUTHENTICATION`) on a provider failure and
 * ends the stream when `signal` aborts.
 */
export interface ModelAdapter {
	readonly provider: string;
	readonly model: string;
	stream(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
	/** Tokens `req` would use as input, when the provider can tell. */
	countTokens?(req: ModelRequest, signal?: AbortSignal): Promise<number>;
}
