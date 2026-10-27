import type { RunAgentOptions, RunError } from './agent-types';
import { AiError } from './errors';
import type { AgentEvent } from './events';
import { type GenerateResult, generate } from './generate';
import type { ModelAdapter, ModelRequest } from './model';
import { notify } from './observers';
import { toolSpec } from './tool';

/** Wraps a model so each event is also emitted as the run's own event. */
function tee(model: ModelAdapter, emit: (e: AgentEvent) => void): ModelAdapter {
	return {
		provider: model.provider,
		model: model.model,
		async *stream(req, signal) {
			for await (const event of model.stream(req, signal)) {
				if (event.type === 'text-delta') emit(event);
				else if (event.type === 'thinking-delta') emit(event);
				else if (event.type === 'tool-call') emit(event);
				yield event;
			}
		},
	};
}

export const toRunError = (error: unknown): RunError =>
	error instanceof AiError
		? { code: error.code, message: error.message }
		: {
				code: 'MODEL_ERROR',
				message: error instanceof Error ? error.message : String(error),
			};

export function buildRequest(
	options: RunAgentOptions,
	messages: ModelRequest['messages'],
): ModelRequest {
	const { system, tools } = options;
	const req: ModelRequest = { messages };
	if (system !== undefined) {
		req.system = typeof system === 'string' ? [{ text: system }] : system;
	}
	if (tools?.length) req.tools = tools.map(toolSpec);
	return req;
}

/** One model call, streamed to `emit`, reported to the observers. */
export async function modelStep(
	options: RunAgentOptions,
	req: ModelRequest,
	step: number,
	signal: AbortSignal,
	emit: (event: AgentEvent) => void,
): Promise<GenerateResult> {
	const started = performance.now();
	try {
		const out = await generate(tee(options.model, emit), req, signal);
		await notify(options.observers, 'onModelCall', {
			step,
			durationMs: performance.now() - started,
			usage: out.usage,
			finishReason: out.finishReason,
		});
		return out;
	} catch (error) {
		await notify(options.observers, 'onModelCall', {
			step,
			durationMs: performance.now() - started,
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
			error: toRunError(error),
		});
		throw error;
	}
}
