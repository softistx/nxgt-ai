import { defineMiddleware } from '@alxia/core';
import type { AgentObserver } from '@nxgt/ai-core';

/** What `aiRequest` puts on the request context as `ai`. */
export interface AiRequest {
	/** Aborts when the client disconnects or the request is aborted. */
	readonly signal: AbortSignal;
	/** The request's language, as the middleware before `aiRequest` read it. */
	readonly language: string;
	/** The observers given to `aiRequest`; one array shared by every request. */
	readonly observers: readonly AgentObserver[];
}

export interface AiRequestOptions {
	/** Observers every run of the app gets, such as `aiTelemetry()`. */
	observers?: readonly AgentObserver[];
}

const NO_OBSERVERS: readonly AgentObserver[] = [];

/**
 * The alxia middleware that gives a handler what `runAgent` needs from the
 * request: `ctx.ai` is `{ signal, language, observers }`, so a handler writes
 * `runAgent({ model, messages, ...ai })`.
 *
 * It reads `language` from the context, so it comes after `@alxia/language`
 * or `@alxia/i18n`.
 *
 * ```ts
 * alxia().use(language({ supported: ['en', 'fr'], fallback: 'en' })).use(aiRequest());
 * ```
 */
export function aiRequest(options: AiRequestOptions = {}) {
	const observers = options.observers ?? NO_OBSERVERS;
	return defineMiddleware<{ language: string }>()(
		({ request, language }, next) => {
			const ai: AiRequest = { signal: request.signal, language, observers };
			return next({ ai });
		},
	);
}
