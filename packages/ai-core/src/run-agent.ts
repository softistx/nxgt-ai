import type {
	AgentResult,
	AgentRun,
	RunAgentOptions,
	RunBudget,
	RunError,
} from './agent-types';
import { AiError } from './errors';
import { createChannel } from './event-channel';
import type { AgentEvent, RunEndReason } from './events';
import {
	addUsage,
	emptyUsage,
	type Message,
	type ProposedActionPart,
	type ToolCallPart,
	type Usage,
} from './message';
import { notify } from './observers';
import { DEFAULT_PROPOSAL_TTL_MS } from './proposed-action';
import { buildRequest, modelStep, toRunError } from './run-step';
import { runToolCalls } from './run-tools';

interface Ending {
	reason: RunEndReason;
	error?: RunError;
}

interface RunState {
	runId: string;
	added: Message[];
	usage: Usage;
	steps: number;
}

type Emit = (event: AgentEvent) => void;

function budgetExceeded(budget: RunBudget | undefined, usage: Usage) {
	if (!budget) return undefined;
	const { maxInputTokens: i, maxOutputTokens: o, maxTotalTokens: t } = budget;
	const total = usage.inputTokens + usage.outputTokens;
	if (i !== undefined && usage.inputTokens >= i) return `input ${i}`;
	if (o !== undefined && usage.outputTokens >= o) return `output ${o}`;
	if (t !== undefined && total >= t) return `total ${t}`;
	return undefined;
}

/** The ending forced before the next model call, if any. */
function limitEnding(
	options: RunAgentOptions,
	state: RunState,
): Ending | undefined {
	const spent = budgetExceeded(options.budget, state.usage);
	if (spent) {
		const message = `The token budget (${spent}) is spent.`;
		return { reason: 'budget', error: { code: 'BUDGET_EXCEEDED', message } };
	}
	const max = options.maxSteps ?? 8;
	if (state.steps >= max) {
		const message = `The run reached its limit of ${max} model calls.`;
		return { reason: 'max-steps', error: { code: 'MAX_STEPS', message } };
	}
	return undefined;
}

/** One model call and, if it asked for tools, their results. */
async function step(
	options: RunAgentOptions,
	state: RunState,
	signal: AbortSignal,
	emit: Emit,
): Promise<Ending | undefined> {
	state.steps += 1;
	emit({ type: 'step-start', step: state.steps, runId: state.runId });
	const req = buildRequest(options, [...options.messages, ...state.added]);
	const out = await modelStep(
		options,
		state.runId,
		req,
		state.steps,
		signal,
		emit,
	);
	state.usage = addUsage(state.usage, out.usage);
	emit({ type: 'usage', usage: out.usage });
	const calls = out.message.parts.filter(
		(part): part is ToolCallPart => part.type === 'tool-call',
	);
	if (out.finishReason !== 'tool-use' || calls.length === 0) {
		state.added.push(out.message);
		emit({ type: 'message', message: out.message });
		const reason = out.finishReason === 'tool-use' ? 'end' : out.finishReason;
		return { reason };
	}
	emit({ type: 'message', message: out.message });
	const tools = new Map((options.tools ?? []).map((t) => [t.name, t]));
	const proposals: ProposedActionPart[] = [];
	const results = await runToolCalls(calls, {
		tools,
		ttlMs: options.proposalTtlMs ?? DEFAULT_PROPOSAL_TTL_MS,
		now: options.now ?? Date.now,
		proposals,
		context: options.context,
		signal,
		step: state.steps,
		runId: state.runId,
		observers: options.observers,
		emit,
	});
	const toolMessage: Message = {
		role: 'tool',
		parts: [...results, ...proposals],
	};
	state.added.push(out.message, toolMessage);
	emit({ type: 'message', message: toolMessage });
	return signal.aborted ? { reason: 'aborted' } : undefined;
}

const abortedEnding = (signal: AbortSignal): Ending => ({
	reason: 'aborted',
	error: {
		code: 'ABORTED',
		message:
			signal.reason instanceof Error
				? signal.reason.message
				: 'The run was aborted.',
	},
});

async function loop(
	options: RunAgentOptions,
	state: RunState,
	signal: AbortSignal,
	emit: Emit,
): Promise<Ending> {
	try {
		for (;;) {
			if (signal.aborted) return abortedEnding(signal);
			const limit = limitEnding(options, state);
			if (limit) return limit;
			const ending = await step(options, state, signal, emit);
			if (ending)
				return ending.reason === 'aborted' ? abortedEnding(signal) : ending;
		}
	} catch (error) {
		if (
			signal.aborted ||
			(error instanceof AiError && error.code === 'ABORTED')
		) {
			return abortedEnding(signal);
		}
		return { reason: 'error', error: toRunError(error) };
	}
}

const lastText = (messages: readonly Message[]): string => {
	const last = messages.findLast((m) => m.role === 'assistant');
	return (last?.parts ?? [])
		.flatMap((p) => (p.type === 'text' ? [p.text] : []))
		.join('');
};

async function execute(
	options: RunAgentOptions,
	signal: AbortSignal,
	emit: Emit,
): Promise<AgentResult> {
	const runId = (options.newId ?? (() => crypto.randomUUID()))();
	const state: RunState = { runId, added: [], usage: emptyUsage(), steps: 0 };
	await notify(options.observers, 'onRunStart', {
		runId,
		provider: options.model.provider,
		model: options.model.model,
		messages: options.messages,
		tools: (options.tools ?? []).map((t) => t.name),
	});
	const ending = await loop(options, state, signal, emit);
	if (ending.error && ending.reason !== 'aborted') {
		emit({ type: 'error', error: ending.error });
	}
	emit({ type: 'done', reason: ending.reason, usage: state.usage });
	const result: AgentResult = {
		runId,
		reason: ending.reason,
		messages: state.added,
		text: lastText(state.added),
		usage: state.usage,
		steps: state.steps,
		...(ending.error ? { error: ending.error } : {}),
	};
	await notify(options.observers, 'onRunEnd', result);
	return result;
}

/**
 * Runs the agent loop: the model answers, its tool calls run in parallel and
 * their results go back to it, until it stops, a limit is reached or the run
 * is aborted. The run starts at once; events buffer until read.
 */
export function runAgent(options: RunAgentOptions): AgentRun {
	const controller = new AbortController();
	const outer = options.signal;
	const onOuterAbort = () => controller.abort(outer?.reason);
	if (outer?.aborted) onOuterAbort();
	else outer?.addEventListener('abort', onOuterAbort, { once: true });
	const channel = createChannel<AgentEvent>();
	const result = execute(options, controller.signal, channel.push).finally(
		() => {
			outer?.removeEventListener('abort', onOuterAbort);
			channel.close();
		},
	);
	return {
		result,
		abort: (reason) => controller.abort(reason),
		[Symbol.asyncIterator]: () => channel[Symbol.asyncIterator](),
	};
}
