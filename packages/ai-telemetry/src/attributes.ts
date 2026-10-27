import type {
	Message,
	ToolCallPart,
	ToolResultPart,
	Usage,
} from '@nxgt/ai-core';

/** gen_ai.* names, after the OpenTelemetry generative AI conventions. */
export const OPERATION = 'gen_ai.operation.name';

const FINISH: Record<string, string> = {
	end: 'stop',
	'tool-use': 'tool_calls',
	'max-tokens': 'length',
	refusal: 'content_filter',
};

export const finishReason = (reason: string): string =>
	FINISH[reason] ?? reason;

/** `inputTokens` counts all input, cached included, as `gen_ai.usage.input_tokens` does. */
export const usageAttributes = (usage: Usage) => ({
	'gen_ai.usage.input_tokens': usage.inputTokens,
	'gen_ai.usage.output_tokens': usage.outputTokens,
	'gen_ai.usage.cache_read.input_tokens': usage.cacheReadTokens,
	'gen_ai.usage.cache_creation.input_tokens': usage.cacheWriteTokens,
});

export const providerAttributes = (provider: string, model: string) => ({
	'gen_ai.provider.name': provider,
	'gen_ai.system': provider,
	'gen_ai.request.model': model,
});

export const toolAttributes = (call: ToolCallPart, step: number) => ({
	[OPERATION]: 'execute_tool',
	'gen_ai.tool.name': call.name,
	'gen_ai.tool.call.id': call.id,
	'ai.step': step,
});

const json = (value: unknown): string => {
	try {
		return JSON.stringify(value) ?? '';
	} catch {
		return '[unserializable]';
	}
};

/** Only used when `recordContent` is on. */
export const toolContent = (call: ToolCallPart, result: ToolResultPart) => ({
	'gen_ai.tool.call.arguments': json(call.input),
	'gen_ai.tool.call.result': json(
		result.isError ? result.error : result.output,
	),
});

export const messagesContent = (
	name: string,
	messages: readonly Message[],
) => ({
	[name]: json(messages),
});
