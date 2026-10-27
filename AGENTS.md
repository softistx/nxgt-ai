# AGENTS.md

The single source of truth for any coding agent working in nxgt-ai. The
owner's global rules (worktrees, Conventional Commits, merges, shared machine,
issues and roadmap) are in `~/.claude/CLAUDE.md` and apply here unchanged.

## What this is

A public Bun workspace of packages published to npm under `@nxgt/ai-*`: a
Bun-native AI agents SDK. Skeleton: nxgt-data (see the
`nxgt-monorepo:lay-out-a-library-monorepo` skill). The root files it names as
shared are copied byte for byte from nxgt-data; fix a drift there first.

## Packages

| package              | role                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| `@nxgt/ai-core`      | messages, Zod tools, model port, agent loop, proposed actions            |
| `@nxgt/ai-anthropic` | Anthropic adapter                                                        |
| `@nxgt/ai-ollama`    | Ollama adapter                                                           |
| `@nxgt/ai-testing`   | `fakeModel`, `collect`                                                   |
| `@nxgt/ai-memory`    | memory port, compaction, subpaths `.`, `./mongo`, `./redis`, `./testing` |
| `@nxgt/ai-graphql`   | GraphQL operations as tools; `./codegen`                                 |
| `@nxgt/ai-alxia`     | request middleware and SSE reply for alxia                               |
| `@nxgt/ai-mcp`       | MCP client and server, `./client`, `./server`                            |
| `@nxgt/ai-telemetry` | `aiTelemetry` observer over `@nxgt/telemetry`                            |

## Rules

- **Providers use Bun `fetch`.** The Anthropic and Ollama adapters have no
  third-party client (no `@anthropic-ai/sdk`, no `ollama` package): SSE and
  NDJSON are parsed in the package.
- **`@modelcontextprotocol/sdk` is the only external runtime dependency** in
  the repository, and only in `@nxgt/ai-mcp`. Every other package has no
  `dependencies`; `zod` and `typescript` are peers, siblings are peers as
  `workspace:^` plus a devDependency.
- **Infrastructure goes through the `@nxgt` packages** (`@nxgt/mongo`,
  `@nxgt/redis`, `@nxgt/telemetry`, `@alxia/*`), as the global rules say.
- **Testing subpaths** (`./testing`) ship fakes and contract suites
  (`memoryStoreContract`); test-only code never ships elsewhere. A package
  that adds a store ships its contract.
- **No private app names in docs, READMEs, code or issues.** Examples use
  generic domains.
- Imports carry no extension; consumers resolve with
  `"moduleResolution": "bundler"` (each README says so).
- Every package is `"private": true` until its release-readiness slice
  removes it, in a commit of its own.
- Every slice carries specs, README/docs, a changeset and a green bar:
  `bun install`, `bunx biome ci`, `bun run build`, `bun run typecheck`,
  `bun run test`, `bun run verify:artifacts`.

## Workflow

An effort has an integration branch (`feat/ai-core`, `feat/ai-memory-graphql`,
`feat/ai-mcp`); slice PRs go into it and one PR goes into `develop`. See
`docs/roadmap.md` for what is planned. Releases go through changesets and the
`Release` workflow; the npm token is `NPM_TOKEN` in the GitHub environment
`npm`, never a repository secret.

## Declared divergences from nxgt-data

- No `examples/` workspace, no service scripts yet (the Mongo and Redis test
  scripts arrive with `@nxgt/ai-memory`).
- `ci.yml` has no Meilisearch/SeaweedFS caches and no newest-peers job.
- `CLAUDE.md` is the one-line import `@AGENTS.md`; the comments in the
  workflow files are condensed from nxgt-data's.
- `biome.json` also excludes `.changeset/*.md`: Biome 2.6.3 (locked here) reformats a
  changeset's front matter into a heading; nxgt-data's 2.5.15 did not.
