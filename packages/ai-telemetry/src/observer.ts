import {
	type AgentObserver,
	type AgentResult,
	AiError,
	type RunError,
} from '@nxgt/ai-core';
import type { Telemetry } from '@nxgt/telemetry';
import { resolveTelemetry } from '@nxgt/telemetry';
import {
	finishReason,
	messagesContent,
	OPERATION,
	providerAttributes,
	toolAttributes,
	toolContent,
	usageAttributes,
} from './attributes';
import { openSpan, type SpanHandle } from './handle';

type Hook<K extends keyof AgentObserver> = NonNullable<AgentObserver[K]>;

export interface AiTelemetryOptions {
	/** The telemetry to write to; default the one in scope or installed. */
	telemetry?: Telemetry;
	/** Also record prompts, tool arguments and results, and the answer. Default off. */
	recordContent?: boolean;
}

/** Marks a span as cancelled, not failed, or as failed with the run's code. */
function fail(handle: SpanHandle, error: RunError): void {
	handle.scope.attribute('ai.error.code', error.code);
	if (error.code === 'ABORTED') {
		handle.scope.fail(new DOMException(error.message, 'AbortError'));
	} else {
		handle.scope.fail(new AiError(error.code, error.message));
	}
}

class SpanObserver implements AgentObserver {
	private run: SpanHandle | undefined;
	private provider = '';
	private model = '';
	private readonly calls = new Map<string, SpanHandle>();

	constructor(
		private readonly options: AiTelemetryOptions,
		private readonly recordContent: boolean,
	) {}

	private target(): Telemetry | undefined {
		return this.options.telemetry ?? resolveTelemetry();
	}

	private child(name: string, attributes: Record<string, unknown>) {
		return openSpan(name, attributes, this.run?.context, this.target());
	}

	private endAll(): void {
		for (const handle of this.calls.values()) handle.end();
		this.calls.clear();
	}

	private open(key: string, handle: SpanHandle): void {
		this.calls.get(key)?.end();
		this.calls.set(key, handle);
	}

	private take(key: string): SpanHandle | undefined {
		const handle = this.calls.get(key);
		this.calls.delete(key);
		return handle;
	}

	onRunStart: Hook<'onRunStart'> = (info) => {
		this.endAll();
		this.run?.end();
		this.provider = info.provider;
		this.model = info.model;
		this.run = openSpan(
			'ai.agent.run',
			{
				[OPERATION]: 'invoke_agent',
				...providerAttributes(this.provider, this.model),
				'ai.agent.tools': [...info.tools],
				...(this.recordContent
					? messagesContent('gen_ai.input.messages', info.messages)
					: {}),
			},
			undefined,
			this.target(),
		);
	};

	onModelStart: Hook<'onModelStart'> = ({ step }) => {
		this.open(
			`model:${step}`,
			this.child('ai.model.call', {
				[OPERATION]: 'chat',
				...providerAttributes(this.provider, this.model),
				'ai.step': step,
			}),
		);
	};

	onModelCall: Hook<'onModelCall'> = (info) => {
		const handle = this.take(`model:${info.step}`);
		if (!handle) return;
		handle.scope.attributes({
			...usageAttributes(info.usage),
			'ai.duration_ms': Math.round(info.durationMs),
			...(info.finishReason
				? {
						'gen_ai.response.finish_reasons': [finishReason(info.finishReason)],
					}
				: {}),
		});
		if (info.error) fail(handle, info.error);
		handle.end();
	};

	onToolStart: Hook<'onToolStart'> = ({ step, call }) => {
		this.open(
			`tool:${call.id}`,
			this.child('ai.tool.call', toolAttributes(call, step)),
		);
	};

	onToolCall: Hook<'onToolCall'> = ({ call, result, durationMs }) => {
		const handle = this.take(`tool:${call.id}`);
		if (!handle) return;
		handle.scope.attribute('ai.duration_ms', Math.round(durationMs));
		if (this.recordContent) {
			handle.scope.attributes(toolContent(call, result));
		}
		if (result.isError) fail(handle, result.error);
		handle.end();
	};

	onRunEnd: Hook<'onRunEnd'> = (result: AgentResult) => {
		this.endAll();
		const run = this.run;
		this.run = undefined;
		if (!run) return;
		run.scope.attributes({
			...usageAttributes(result.usage),
			'ai.agent.steps': result.steps,
			'ai.agent.reason': result.reason,
			...(this.recordContent
				? messagesContent('gen_ai.output.messages', result.messages)
				: {}),
		});
		if (result.error) fail(run, result.error);
		run.end();
	};
}

/**
 * An `AgentObserver` that writes the run as spans: `ai.agent.run` with an
 * `ai.model.call` per model call and an `ai.tool.call` per tool call under it.
 * It keeps the state of one run, so build one per `runAgent` call.
 */
export function aiTelemetry(options: AiTelemetryOptions = {}): AgentObserver {
	return new SpanObserver(options, options.recordContent ?? false);
}
