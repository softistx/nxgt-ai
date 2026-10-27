import { afterEach, describe, expect, test } from 'bun:test';
import { defineTool, runAgent } from '@nxgt/ai-core';
import { fakeModel } from '@nxgt/ai-testing';
import {
	createTelemetry,
	type Exporter,
	type Signal,
	type SpanRecord,
	uninstallTelemetry,
} from '@nxgt/telemetry';
import { z } from 'zod';
import { aiTelemetry } from './index';

afterEach(() => uninstallTelemetry());

const usage = {
	inputTokens: 10,
	outputTokens: 4,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
};
const user = [
	{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'go' }] },
];
const echo = defineTool({
	name: 'echo',
	description: 'Echoes',
	input: z.object({ v: z.string() }),
	execute: ({ v }) => ({ v }),
});

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

const named = (spans: SpanRecord[], name: string) =>
	spans.filter((s) => s.name === name);

describe('aiTelemetry, concurrent runs', () => {
	test('one observer serves two concurrent runs with separate span trees', async () => {
		const { telemetry, spans } = collector();
		const observer = aiTelemetry({ telemetry });
		const start = (text: string, delayMs: number) =>
			runAgent({
				model: fakeModel([
					{ toolCalls: [{ name: 'echo', input: { v: text } }], usage },
					{ text, delayMs, usage },
				]),
				messages: user,
				tools: [echo],
				observers: [observer],
			});
		const a = start('a', 30);
		const b = start('b', 5);
		await Promise.all([a.result, b.result]);
		const all = await spans();
		const roots = named(all, 'ai.agent.run');
		expect(roots).toHaveLength(2);
		expect(roots[0]?.context.traceId).not.toBe(roots[1]?.context.traceId);
		for (const root of roots) {
			const kids = all.filter((s) => s.parent === root.context.spanId);
			expect(kids.map((k) => k.name).sort()).toEqual([
				'ai.model.call',
				'ai.model.call',
				'ai.tool.call',
			]);
			for (const kid of kids) {
				expect(kid.context.traceId).toBe(root.context.traceId);
				expect(kid.status).toBe('ok');
			}
			expect(root.attributes['ai.agent.steps']).toBe(2);
		}
		expect(all).toHaveLength(8);
	});
});
