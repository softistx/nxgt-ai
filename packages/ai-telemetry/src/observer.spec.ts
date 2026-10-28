import { afterEach, describe, expect, test } from 'bun:test';
import { AiError, type AnyTool, defineTool, runAgent } from '@nxgt/ai-core';
import { collect, fakeModel } from '@nxgt/ai-testing';
import {
	createTelemetry,
	type Exporter,
	type Signal,
	type SpanRecord,
	uninstallTelemetry,
	withTelemetry,
} from '@nxgt/telemetry';
import { z } from 'zod';
import { type AiTelemetryOptions, aiTelemetry } from './index';

afterEach(() => uninstallTelemetry());

const usage = {
	inputTokens: 10,
	outputTokens: 4,
	cacheReadTokens: 6,
	cacheWriteTokens: 2,
};
const user = [
	{
		role: 'user' as const,
		parts: [{ type: 'text' as const, text: 'secret prompt' }],
	},
];
const echo = defineTool({
	name: 'echo',
	description: 'Echoes',
	input: z.object({ v: z.string() }),
	execute: ({ v }) => ({ v: `out-${v}` }),
});
const boom = defineTool({
	name: 'boom',
	description: 'Fails',
	input: z.object({}),
	execute: () => {
		throw new Error('nope');
	},
});

type Observer = ReturnType<typeof aiTelemetry>;

function collector() {
	const signals: Signal[] = [];
	const exporter: Exporter = {
		export: (_resource, batch) => void signals.push(...batch),
	};
	const telemetry = createTelemetry('test', {
		exporters: [exporter],
		batch: 1,
	});
	const spans = async () => {
		await telemetry.close();
		return signals.filter((s): s is SpanRecord => s.type === 'span');
	};
	return { telemetry, spans };
}

async function traced(
	options: AiTelemetryOptions,
	start: (observer: Observer) => ReturnType<typeof runAgent>,
): Promise<SpanRecord[]> {
	const { telemetry, spans } = collector();
	const run = start(aiTelemetry({ telemetry, ...options }));
	await collect(run);
	await run.result;
	return spans();
}

const named = (spans: SpanRecord[], name: string) =>
	spans.filter((s) => s.name === name);
const only = (spans: SpanRecord[], name: string): SpanRecord =>
	named(spans, name)[0] as SpanRecord;

const toolRun = (
	observer: Observer,
	tool: AnyTool = echo,
	input: object = {},
) =>
	runAgent({
		model: fakeModel([
			{ toolCalls: [{ name: tool.name, input }], usage },
			{ text: 'the answer', usage },
		]),
		messages: user,
		tools: [tool],
		observers: [observer],
	});

describe('aiTelemetry', () => {
	test('the span tree: a run, a model call per step, a tool call', async () => {
		const spans = await traced({}, (o) => toolRun(o, echo, { v: 'x' }));
		const root = only(spans, 'ai.agent.run');
		const children = [
			...named(spans, 'ai.model.call'),
			...named(spans, 'ai.tool.call'),
		];
		expect(root.parent).toBeUndefined();
		expect(children).toHaveLength(3);
		for (const child of children) {
			expect(child.parent).toBe(root.context.spanId);
			expect(child.context.traceId).toBe(root.context.traceId);
		}
		expect(root.status).toBe('ok');
		expect(root.startedAt).toBeLessThanOrEqual(
			Math.min(...children.map((c) => c.startedAt)),
		);
		expect(root.endedAt).toBeGreaterThanOrEqual(
			Math.max(...children.map((c) => c.endedAt)),
		);
	});

	test('gen_ai attributes on the run, the model calls and the tool call', async () => {
		const spans = await traced({}, (o) => toolRun(o, echo, { v: 'x' }));
		expect(only(spans, 'ai.agent.run').attributes).toMatchObject({
			'gen_ai.operation.name': 'invoke_agent',
			'gen_ai.provider.name': 'fake',
			'gen_ai.request.model': 'fake-1',
			'gen_ai.usage.input_tokens': 20,
			'gen_ai.usage.output_tokens': 8,
			'ai.agent.steps': 2,
			'ai.agent.reason': 'end',
			'ai.agent.tools': ['echo'],
		});
		const first = named(spans, 'ai.model.call').find(
			(s) => s.attributes['ai.step'] === 1,
		);
		expect(first?.attributes).toMatchObject({
			'gen_ai.operation.name': 'chat',
			'gen_ai.usage.input_tokens': 10,
			'gen_ai.usage.output_tokens': 4,
			'gen_ai.usage.cache_read.input_tokens': 6,
			'gen_ai.usage.cache_creation.input_tokens': 2,
			'gen_ai.response.finish_reasons': ['tool_calls'],
		});
		expect(only(spans, 'ai.tool.call').attributes).toMatchObject({
			'gen_ai.operation.name': 'execute_tool',
			'gen_ai.tool.name': 'echo',
			'gen_ai.tool.call.id': 'call_0_0',
		});
	});

	test('no content by default', async () => {
		const spans = await traced({}, (o) => toolRun(o, echo, { v: 'topsecret' }));
		const dump = JSON.stringify(spans);
		for (const text of ['secret prompt', 'topsecret', 'the answer']) {
			expect(dump).not.toContain(text);
		}
	});

	test('recordContent adds the prompt, the tool arguments and result, the answer', async () => {
		const spans = await traced({ recordContent: true }, (o) =>
			toolRun(o, echo, { v: 'topsecret' }),
		);
		const root = only(spans, 'ai.agent.run').attributes;
		expect(String(root['gen_ai.input.messages'])).toContain('secret prompt');
		expect(String(root['gen_ai.output.messages'])).toContain('the answer');
		const tool = only(spans, 'ai.tool.call').attributes;
		expect(String(tool['gen_ai.tool.call.arguments'])).toContain('topsecret');
		expect(String(tool['gen_ai.tool.call.result'])).toContain('out-topsecret');
	});

	test('a tool error fails its span, not the run', async () => {
		const spans = await traced({}, (o) => toolRun(o, boom));
		const tool = only(spans, 'ai.tool.call');
		expect(tool.status).toBe('error');
		expect(tool.attributes['ai.error.code']).toBe('TOOL_FAILED');
		expect(only(spans, 'ai.agent.run').status).toBe('ok');
	});

	test('a confirm tool span is marked proposed, a normal one is not', async () => {
		const pay = defineTool({
			name: 'pay',
			description: 'Pays',
			input: z.object({}),
			confirm: true,
			execute: () => ({}),
		});
		const proposed = await traced({}, (o) => toolRun(o, pay));
		const span = only(proposed, 'ai.tool.call');
		expect(span.attributes['ai.tool.proposed']).toBe(true);
		expect(span.status).toBe('ok');
		const normal = await traced({}, (o) => toolRun(o, echo, { v: 'x' }));
		expect(only(normal, 'ai.tool.call').attributes).not.toHaveProperty(
			'ai.tool.proposed',
		);
	});

	test('a model error fails the call and the run', async () => {
		const spans = await traced({}, (o) =>
			runAgent({
				model: fakeModel([{ error: new AiError('RATE_LIMITED', 'slow down') }]),
				messages: user,
				observers: [o],
			}),
		);
		expect(only(spans, 'ai.model.call').status).toBe('error');
		const root = only(spans, 'ai.agent.run');
		expect(root.status).toBe('error');
		expect(root.attributes['ai.error.code']).toBe('RATE_LIMITED');
	});

	test('an unknown error code is recorded as it came', async () => {
		const error = Object.assign(new AiError('MODEL_ERROR', 'newer'), {
			code: 'FUTURE_CODE',
		});
		const spans = await traced({}, (o) =>
			runAgent({
				model: fakeModel([{ error }]),
				messages: user,
				observers: [o],
			}),
		);
		const root = only(spans, 'ai.agent.run');
		expect(root.status).toBe('error');
		expect(root.attributes['ai.error.code']).toBe('FUTURE_CODE');
	});

	test('an abort is cancelled, not an error', async () => {
		const spans = await traced({}, (o) => {
			const run = runAgent({
				model: fakeModel([{ text: 'late', delayMs: 5000 }]),
				messages: user,
				observers: [o],
			});
			setTimeout(() => run.abort(), 10);
			return run;
		});
		expect(only(spans, 'ai.model.call').status).toBe('cancelled');
		const root = only(spans, 'ai.agent.run');
		expect(root.status).toBe('cancelled');
		expect(root.attributes['ai.agent.reason']).toBe('aborted');
	});

	test('uses the telemetry in scope when none is passed', async () => {
		const { telemetry, spans } = collector();
		await withTelemetry(telemetry, () => toolRun(aiTelemetry()).result);
		expect(await spans()).toHaveLength(4);
	});

	test('runs fine with no telemetry at all', async () => {
		const run = toolRun(aiTelemetry(), echo, { v: 'x' });
		expect((await run.result).reason).toBe('end');
	});
});
