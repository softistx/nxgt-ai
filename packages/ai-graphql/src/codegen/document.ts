import {
	type DefinitionNode,
	type FragmentDefinitionNode,
	Kind,
	type OperationDefinitionNode,
	print,
	visit,
} from 'graphql';
import { fail } from './config';

/** Adds a fragment; the same name with other text in two documents is refused. */
export function addFragment(
	fragments: Map<string, FragmentDefinitionNode>,
	fragment: FragmentDefinitionNode,
): void {
	const name = fragment.name.value;
	const known = fragments.get(name);
	if (known && print(known) !== print(fragment)) {
		fail(
			`fragment "${name}" is defined in two documents with different text; rename one.`,
		);
	}
	fragments.set(name, fragment);
}

/** The operation and the fragments it uses, transitively, sorted by name. */
export function documentOf(
	node: OperationDefinitionNode,
	fragments: ReadonlyMap<string, FragmentDefinitionNode>,
	name: string,
): string {
	const used = new Map<string, FragmentDefinitionNode>();
	const walk = (root: DefinitionNode) => {
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
				walk(fragment);
			},
		});
	};
	walk(node);
	// A graphql 17 description is left out so any graphql version parses the text.
	const clean = { ...node, description: undefined } as OperationDefinitionNode;
	const sorted = [...used.values()].sort((a, b) =>
		a.name.value.localeCompare(b.name.value, 'en'),
	);
	return print({ kind: Kind.DOCUMENT, definitions: [clean, ...sorted] });
}
