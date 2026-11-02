#!/usr/bin/env node
/**
 * The same core the browser runs, under Node with no DOM or GPU.
 *
 *   node bin/cutaway.ts src/examples/oidc.mmd --svg out.svg --json out.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { compile, FORMAT_NAMES, ParseError, renderSvg, themeById } from '../src/core/index.ts';

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		svg: { type: 'string' },
		json: { type: 'string' },
		theme: { type: 'string', default: 'survey' }
	}
});

const input = positionals[0];
if (!input) {
	console.error(
		'Usage: node bin/cutaway.ts <diagram> [--svg out.svg] [--json out.json] [--theme survey]'
	);
	process.exit(2);
}

try {
	const { scene, script } = compile(readFileSync(input, 'utf8'));
	const { diagram } = scene;
	console.log(`${diagram.title} (${FORMAT_NAMES[diagram.format]})`);
	console.log(
		`${diagram.layers.length} layers, ${diagram.nodes.length} nodes, ${scene.routes.length} routes, ${script.steps.length} steps, ${script.duration.toFixed(1)}s`
	);
	for (const warning of diagram.warnings) console.warn(`warning: ${warning.message}`);
	if (values.svg) writeFileSync(values.svg, renderSvg(scene, themeById(values.theme)));
	if (values.json) writeFileSync(values.json, JSON.stringify({ scene, script }, null, 2));
} catch (error) {
	if (error instanceof ParseError) {
		console.error(`${input}${error.line ? `:${error.line}` : ''}: ${error.message}`);
		process.exit(1);
	}
	throw error;
}
