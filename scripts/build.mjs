import {build} from 'esbuild';

const stubDevtools = {
	name: 'stub-react-devtools-core',
	setup(b) {
		b.onResolve({filter: /^react-devtools-core$/}, () => ({path: 'react-devtools-core', namespace: 'stub'}));
		b.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: 'export default {};'}));
	},
};

await build({
	entryPoints: ['src/cli.tsx'],
	outfile: 'dist/ghpr.mjs',
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node22',
	minify: true,
	plugins: [stubDevtools],
	define: {'process.env.NODE_ENV': '"production"'},
	banner: {
		js: "#!/usr/bin/env node\nimport {createRequire} from 'node:module';\nconst require = createRequire(import.meta.url);",
	},
});
