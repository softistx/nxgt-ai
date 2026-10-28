import type { PluginFunction } from '@graphql-codegen/plugin-helpers';
import {
	type DefinitionNode,
	type DocumentNode,
	type FragmentDefinitionNode,
	Kind,
	type OperationDefinitionNode,
	parse,
	print,
	visit,
} from 'graphql';

/** Options of the plugin, under `config` in `codegen.ts`. */
export interface OperationsManifestConfig {
	/** Name of the exported array; default `operations`. */
	exportName?: string;
	/**
	 * Where the `z<Op>Variables` schemas are imported from, written into the
	 * file as given (add `.js` under `nodenext`); default `./zod`, the file
	 * `@nxgt/graphql-codegen-zod` writes beside the manifest.
	 */
	zodImport?: string;
	/** Where `GraphqlOperation` is imported from; default `@nxgt/ai-graphql`. */
	typesImport?: string;
	/** Tool name by GraphQL operation name; default: the operation name. */
	names?: Record<string, string>;
	/** Mirror of `@nxgt/graphql-codegen-zod`'s `schemaPrefix`; default `z`. */
	schemaPrefix?: string;
	/** Mirror of its `dedupeOperationSuffix`; default `false`. */
	dedupeOperationSuffix?: boolean;
	/** Mirror of its `omitOperationSuffix`; default `false`. */
	omitOperationSuffix?: boolean;
}

const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TOOL_COMMENT = /^#\s*tool:\s*(.*)$/;

function fail(message: string): never {
	throw new Error(`@nxgt/ai-graphql/codegen: ${message}`);
}

interface Found {
	node: OperationDefinitionNode;
	/** The source text the node was parsed from, when it kept its location. */
	body: string | undefined;
}

function definitionsOf(file: {
	document?: DocumentNode | undefined;
	rawSDL?: string | undefined;
}): { definitions: readonly DefinitionNode[]; body: string | undefined } {
	// Comments exist only in the source: parse it again to read them.
	if (file.rawSDL) {
		try {
			return {
				definitions: parse(file.rawSDL).definitions,
				body: file.rawSDL,
			};
		} catch {
			// fall back to the parsed document
		}
	}
	const document = file.document;
	return {
		definitions: document?.definitions ?? [],
		body: document?.loc?.source.body,
	};
}

/** A `# tool:` comment block directly above `start`, joined into one line. */
function toolComment(body: string, start: number): string | undefined {
	const lines = body.slice(0, start).split(/\r\n|\r|\n/);
	lines.pop(); // the text before the operation on its own line
	const block: string[] = [];
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = (lines[i] ?? '').trim();
		if (!line.startsWith('#')) break;
		block.unshift(line);
	}
	const first = block.findIndex((l) => TOOL_COMMENT.test(l));
	if (first === -1) return undefined;
	const parts = block.slice(first).map((l, i) => {
		const text =
			i === 0 ? (TOOL_COMMENT.exec(l)?.[1] ?? '') : l.replace(/^#\s?/, '');
		return text.trim();
	});
	const text = parts.filter(Boolean).join(' ');
	return text || undefined;
}

function describe(found: Found, name: string): string {
	// graphql 17 parses a description on an operation.
	const own = (found.node as { description?: { value: string } }).description;
	if (own?.value.trim()) return own.value.trim();
	const start = found.node.loc?.start;
	if (found.body !== undefined && start !== undefined) {
		const comment = toolComment(found.body, start);
		if (comment) return comment;
	}
	return fail(
		`operation "${name}" has no description. Describe it with a """description""" above it (graphql 17) or a "# tool: …" comment directly above it: the model reads it to choose the tool.`,
	);
}

function pascal(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

function variablesName(
	op: string,
	kind: 'query' | 'mutation',
	config: OperationsManifestConfig,
): string {
	const suffix = kind === 'query' ? 'Query' : 'Mutation';
	const base = pascal(op);
	const tail =
		config.omitOperationSuffix ||
		(config.dedupeOperationSuffix && base.endsWith(suffix))
			? ''
			: suffix;
	return `${config.schemaPrefix ?? 'z'}${base}${tail}Variables`;
}

/** The operation and the fragments it uses, transitively, sorted. */
function documentOf(
	node: OperationDefinitionNode,
	fragments: ReadonlyMap<string, FragmentDefinitionNode>,
	name: string,
): string {
	const used = new Map<string, FragmentDefinitionNode>();
	const visitNode = (root: DefinitionNode) => {
		visit(root, {
			FragmentSpread(spread) {
				const fragmentName = spread.name.value;
				if (used.has(fragmentName)) return;
				const fragment = fragments.get(fragmentName);
				if (!fragment) {
					fail(
						`operation "${name}" spreads the fragment "${fragmentName}", which is in none of the documents.`,
					);
				}
				used.set(fragmentName, fragment);
				visitNode(fragment);
			},
		});
	};
	visitNode(node);
	// Descriptions are a graphql 17 syntax: strip it so any graphql parses the manifest.
	const clean = { ...node, description: undefined } as OperationDefinitionNode;
	const sorted = [...used.values()].sort((a, b) =>
		a.name.value.localeCompare(b.name.value, 'en'),
	);
	return print({
		kind: Kind.DOCUMENT,
		definitions: [clean, ...sorted],
	});
}

function quote(text: string): string {
	return `'${text
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'")
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029')}'`;
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
	const exportName = config.exportName ?? 'operations';
	if (!IDENTIFIER.test(exportName)) {
		fail(`exportName "${exportName}" is not a valid identifier.`);
	}
	const names = config.names ?? {};
	const fragments = new Map<string, FragmentDefinitionNode>();
	const found: Found[] = [];
	for (const file of documents) {
		const { definitions, body } = definitionsOf(file);
		for (const def of definitions) {
			if (def.kind === Kind.FRAGMENT_DEFINITION) {
				fragments.set(def.name.value, def);
			} else if (def.kind === Kind.OPERATION_DEFINITION) {
				found.push({ node: def, body });
			}
		}
	}
	for (const key of Object.keys(names)) {
		if (!found.some((f) => f.node.name?.value === key)) {
			fail(`"names" maps "${key}", which is no operation of the documents.`);
		}
	}

	const entries: {
		tool: string;
		description: string;
		document: string;
		variables: string | undefined;
	}[] = [];
	const seen = new Set<string>();
	for (const f of found) {
		const op = f.node.name?.value;
		if (op === undefined) {
			fail(
				'an anonymous operation cannot become a tool: give it a name (query Name { … }).',
			);
		}
		if (f.node.operation === 'subscription') {
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
		const hasVariables = (f.node.variableDefinitions ?? []).length > 0;
		entries.push({
			tool,
			description: describe(f, op),
			document: documentOf(f.node, fragments, op),
			variables: hasVariables
				? variablesName(op, f.node.operation, config)
				: undefined,
		});
	}
	entries.sort((a, b) => (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0));

	const schemas = [
		...new Set(entries.flatMap((e) => (e.variables ? [e.variables] : []))),
	].sort();
	const lines = [
		'// Generated by @nxgt/ai-graphql/codegen. Do not edit.',
		`import type { GraphqlOperation } from ${quote(config.typesImport ?? '@nxgt/ai-graphql')};`,
	];
	if (schemas.length > 0) {
		lines.push(
			`import { ${schemas.join(', ')} } from ${quote(config.zodImport ?? './zod')};`,
		);
	}
	lines.push('', `export const ${exportName} = [`);
	for (const e of entries) {
		lines.push(
			'\t{',
			`\t\tname: ${quote(e.tool)},`,
			`\t\tdescription: ${quote(e.description)},`,
			`\t\tdocument: ${quote(e.document)},`,
		);
		if (e.variables) lines.push(`\t\tvariables: ${e.variables},`);
		lines.push('\t},');
	}
	lines.push('] satisfies readonly GraphqlOperation[];', '');
	return lines.join('\n');
};
