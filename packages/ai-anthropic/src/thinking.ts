import { AiError, type ThinkingOptions } from '@nxgt/ai-core';

/** The API's minimum thinking budget; used when the request names none. */
export const DEFAULT_THINKING_BUDGET = 1024;

export type ResolvedThinking =
	| { mode: 'budget'; budget: number }
	| { mode: 'adaptive' }
	/** `effort` alone: no `thinking` object is sent. */
	| { mode: 'none' };

const invalid = (message: string) =>
	new AiError('INVALID_REQUEST', `Anthropic thinking: ${message}`);

/**
 * Picks the thinking mode of `t` and refuses an option set that contradicts
 * itself. It knows nothing about models: a combination only some models reject
 * (a budget on the newest ones, an effort level a model lacks) is left to the
 * API's own 400.
 */
export function resolveThinking(t: ThinkingOptions): ResolvedThinking {
	const mode =
		t.mode ??
		(t.budgetTokens === undefined && t.effort !== undefined
			? 'none'
			: 'budget');
	if (mode === 'adaptive' && t.budgetTokens !== undefined)
		throw invalid('`budgetTokens` cannot be used with `mode: "adaptive"`');
	if (mode === 'none' && t.display !== undefined)
		throw invalid(
			'`display` needs a thinking mode: set `mode: "adaptive"` or `budgetTokens`',
		);
	if (mode === 'budget')
		return {
			mode,
			budget: Math.max(
				t.budgetTokens ?? DEFAULT_THINKING_BUDGET,
				DEFAULT_THINKING_BUDGET,
			),
		};
	return { mode };
}
