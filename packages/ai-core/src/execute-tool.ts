import { AiError, type AiIssue } from './errors';
import { errorResult, type ToolCallPart, type ToolResultPart } from './message';
import type { AnyTool, ToolContext } from './tool';

const describe = (issues: readonly AiIssue[]): string =>
	issues
		.map((issue) =>
			issue.path ? `${issue.path}: ${issue.message}` : issue.message,
		)
		.join('; ');

/**
 * Runs one tool call and always answers with a result part: invalid input
 * becomes an `INVALID_TOOL_INPUT` result the model can read and correct, a
 * throwing `execute` a `TOOL_FAILED` one. Only an abort rejects, with the
 * signal's reason, so the loop can stop.
 */
export async function executeTool(
	tool: AnyTool,
	call: ToolCallPart,
	options: { context?: unknown; signal?: AbortSignal } = {},
): Promise<ToolResultPart> {
	const signal = options.signal ?? new AbortController().signal;
	const validation = tool.validate(call.input);
	if (!validation.ok) {
		return errorResult(
			call,
			new AiError(
				'INVALID_TOOL_INPUT',
				`Invalid input for tool "${tool.name}": ${describe(validation.issues)}`,
				{ issues: validation.issues },
			),
		);
	}
	const toolContext: ToolContext = {
		context: options.context,
		signal,
		callId: call.id,
	};
	let output: unknown;
	try {
		output = await tool.execute(validation.value, toolContext);
	} catch (error) {
		signal.throwIfAborted();
		if (error instanceof AiError) return errorResult(call, error);
		const reason = error instanceof Error ? error.message : String(error);
		return errorResult(
			call,
			new AiError('TOOL_FAILED', `Tool "${tool.name}" failed: ${reason}`, {
				cause: error,
			}),
		);
	}
	if (tool.outputSchema) {
		const parsed = tool.outputSchema.safeParse(output);
		if (!parsed.success) {
			return errorResult(
				call,
				new AiError(
					'INVALID_TOOL_OUTPUT',
					`Tool "${tool.name}" returned an invalid output.`,
					{
						cause: parsed.error,
					},
				),
			);
		}
		output = parsed.data;
	}
	return {
		type: 'tool-result',
		callId: call.id,
		name: tool.name,
		isError: false,
		output,
	};
}
