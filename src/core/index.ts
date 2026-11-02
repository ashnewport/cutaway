import { layoutScene, type LayoutOptions } from './layout.ts';
import { detectFormat, FORMAT_NAMES, ParseError, parseDiagram } from './parse/index.ts';
import { buildScript, type ScriptOptions } from './script.ts';
import type { Scene, Script, SourceFormat } from './types.ts';

export * from './types.ts';
export * from './themes.ts';
export { renderSvg } from './svg.ts';
export { detectFormat, FORMAT_NAMES, ParseError, parseDiagram, layoutScene, buildScript };

export interface CompileOptions extends Partial<LayoutOptions>, ScriptOptions {
	format?: SourceFormat;
	hiddenLayers?: number[];
}

export interface Compiled {
	scene: Scene;
	script: Script;
}

/** Source text in, renderable scene and timing plan out. Pure and deterministic. */
export function compile(source: string, options: CompileOptions = {}): Compiled {
	const diagram = parseDiagram(source, options.format);
	const scene = layoutScene(diagram, { gapScale: options.gapScale });
	const script = buildScript(scene, options.hiddenLayers ?? [], { pace: options.pace });
	return { scene, script };
}
