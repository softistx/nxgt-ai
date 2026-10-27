import type { AiErrorCode } from './errors';
import type { AgentEvent, RunEndReason } from './events';
import type { Message, ToolCallPart, ToolResultPart, Usage } from './message';
import type { FinishReason, ModelAdapter, SystemBlock } from './model';
import type { AnyTool } from './tool';

/** Token limits of one run; each is checked between model calls. */
export interface RunBudget {
	maxInputTokens?: number;
	maxOutputTokens?: number;
	/** Input plus output. */
	maxTotalTokens?: number;
}

/** The coded error a run ended with, when it did not end normally. */
export interface RunError {
	code: AiErrorCode;
	message: string;
}

/** What `run.result` resolves to. It never rejects. */
export interface AgentResult {
	/** Identifies this run in every observer hook and in the first event. */
	runId: string;
	reason: RunEndReason;
	/** Messages the run added after the input, complete steps only. */
	messages: Message[];
	/** The last assistant message's text parts, joined. */
	text: string;
	/** Usage summed over every model call. */
	usage: Usage;
	/** Model calls made. */
	steps: number;
	/** Set when `reason` is `max-steps`, `budget`, `aborted` or `error`. */
	error?: RunError;
}

/**
 * Hooks for telemetry and logging. A hook that throws is ignored. Every hook
 * receives the run's `runId`, so one observer can serve concurrent runs.
 */
export interface AgentObserver {
	onRunStart?(info: {
		runId: string;
		provider: string;
		model: string;
		messages: readonly Message[];
		tools: readonly string[];
	}): void | Promise<void>;
	/** Before each model call; `onModelCall` follows it, error or not. */
	onModelStart?(info: { runId: string; step: number }): void | Promise<void>;
	onModelCall?(info: {
		runId: string;
		step: number;
		durationMs: number;
		usage: Usage;
		finishReason?: FinishReason;
		error?: RunError;
	}): void | Promise<void>;
	/** Before each tool call runs; `onToolCall` follows it. */
	onToolStart?(info: {
		runId: string;
		step: number;
		call: ToolCallPart;
	}): void | Promise<void>;
	onToolCall?(info: {
		runId: string;
		step: number;
		call: ToolCallPart;
		result: ToolResultPart;
		durationMs: number;
	}): void | Promise<void>;
	onRunEnd?(result: AgentResult): void | Promise<void>;
}

export interface RunAgentOptions {
	model: ModelAdapter;
	/** A string, or blocks a cache-aware adapter may cache one by one. */
	system?: string | readonly SystemBlock[];
	/** The conversation so far; never mutated. */
	messages: readonly Message[];
	tools?: readonly AnyTool[];
	/** Passed to every tool as `ToolContext.context`. */
	context?: unknown;
	signal?: AbortSignal;
	/** Model calls allowed; default 8. */
	maxSteps?: number;
	budget?: RunBudget;
	observers?: readonly AgentObserver[];
	/** How long a proposed action can be confirmed, in ms; default one hour. */
	proposalTtlMs?: number;
	/** The clock, in epoch ms; default `Date.now`. A test passes a fixed one. */
	now?: () => number;
	/** Makes the run id; default `crypto.randomUUID`. A test passes a fixed one. */
	newId?: () => string;
}

/** One running agent: iterate it for events, await `result` for the outcome. */
export interface AgentRun extends AsyncIterable<AgentEvent> {
	readonly result: Promise<AgentResult>;
	/** Stops the model stream and the running tools; the run ends `aborted`. */
	abort(reason?: unknown): void;
}
