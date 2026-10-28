import { createRequire } from 'node:module';

// `src/client/` and `dist/client/` (or `dist/chunks/`) are both two levels
// under the package root, so one relative path serves the sources and the build.
const pkg = createRequire(import.meta.url)('../../package.json') as {
	version: string;
};

/** This package's version, sent to servers in the handshake. */
export const PACKAGE_VERSION: string = pkg.version;
