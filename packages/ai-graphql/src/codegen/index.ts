import type { PluginFunction } from '@graphql-codegen/plugin-helpers';
import { variablesSchemaName } from '@nxgt/graphql-codegen-zod/naming';
import {
	type FragmentDefinitionNode,
	Kind,
	type OperationDefinitionNode,
} from 'graphql';
import {
	checkConfig,
	fail,
	type OperationsManifestConfig,
	TOOL_NAME,
} from './config';
import { describe } from './description';
import { addFragment, documentOf } from './document';
import { type Entry, render } from './render';
import { parseSource } from './source';

export type { OperationsManifestConfig } from './config';

interface Found {
	node: OperationDefinitionNode;
	body: string | undefined;
}

function collect(documents: Parameters<PluginFunction>[1]): {
	found: Found[];
	fragments: Map<string, FragmentDefinitionNode>;
} {
	const fragments = new Map<string, FragmentDefinitionNode>();
	const found: Found[] = [];
	for (const file of documents) {
		const { definitions, body } = parseSource(file);
		for (const def of definitions) {
			if (def.kind === Kind.FRAGMENT_DEFINITION) addFragment(fragments, def);
			else if (def.kind === Kind.OPERATION_DEFINITION)
				found.push({ node: def, body });
		}
	}
	return { found, fragments };
}

/**
 * A GraphQL Code Generator plugin that writes the operations manifest
 * `graphqlTools` takes: one `GraphqlOperation` per named query or mutation of
 * `documents`, sorted by name, each with its fragments, its description and
 * the `z<Op>Variables` schema `@nxgt/graphql-codegen-zod` wrote.
 */
export const plugin: PluginFunction<OperationsManifestConfig> = (
	_schema,
	documents,
	config,
) => {
	checkConfig(config);
	const names = config.names ?? {};
	const schemaName = (operation: string, kind: 'query' | 'mutation') =>
		variablesSchemaName(config, operation, kind);
	const { found, fragments } = collect(documents);
	for (const key of Object.keys(names)) {
		if (!found.some((f) => f.node.name?.value === key)) {
			fail(`"names" maps "${key}", which is no operation of the documents.`);
		}
	}
	const entries: Entry[] = [];
	const seen = new Set<string>();
	for (const { node, body } of found) {
		const op = node.name?.value;
		if (op === undefined) {
			fail(
				'an anonymous operation cannot become a tool: give it a name (query Name { … }).',
			);
		}
		if (node.operation === 'subscription') {
			fail(
				`operation "${op}" is a subscription; only queries and mutations become tools.`,
			);
		}
		const tool = names[op] ?? op;
		if (!TOOL_NAME.test(tool)) {
			fail(
				`the tool name "${tool}" of operation "${op}" must be letters, digits, "_" and "-", at most 64.`,
			);
		}
		if (seen.has(tool)) {
			fail(
				`two operations are named "${tool}"; rename one or map it in "names".`,
			);
		}
		seen.add(tool);
		entries.push({
			tool,
			description: describe(node, body, op),
			document: documentOf(node, fragments, op),
			variables: (node.variableDefinitions ?? []).length
				? schemaName(op, node.operation)
				: undefined,
		});
	}
	return render(entries, config);
};
