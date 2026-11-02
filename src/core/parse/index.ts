import type { Diagram, SourceFormat } from '../types.ts';
import { parseClass } from './classdiagram.ts';
import { parseDot } from './dot.ts';
import { parseFlowchart } from './flowchart.ts';
import { parseJson } from './json.ts';
import { parsePlantuml } from './plantuml.ts';
import { parseSequence } from './sequence.ts';
import { ParseError, stripFrontmatter } from './shared.ts';
import { parseState } from './state.ts';

export { ParseError };

export const FORMAT_NAMES: Record<SourceFormat, string> = {
	'mermaid-flowchart': 'Mermaid flowchart',
	'mermaid-sequence': 'Mermaid sequence',
	'mermaid-state': 'Mermaid state',
	'mermaid-class': 'Mermaid class',
	plantuml: 'PlantUML',
	dot: 'Graphviz DOT',
	json: 'Cutaway JSON'
};

const PARSERS: Record<SourceFormat, (source: string) => Diagram> = {
	'mermaid-flowchart': parseFlowchart,
	'mermaid-sequence': parseSequence,
	'mermaid-state': parseState,
	'mermaid-class': parseClass,
	plantuml: parsePlantuml,
	dot: parseDot,
	json: parseJson
};

export function detectFormat(source: string): SourceFormat | null {
	const { body } = stripFrontmatter(source);
	const firstLine = body
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(
			(line) =>
				line &&
				!line.startsWith('%%') &&
				!line.startsWith('//') &&
				!line.startsWith('#') &&
				!line.startsWith("'")
		);
	if (!firstLine) return null;
	if (
		/^(flowchart|graph)(\s+(TB|TD|BT|RL|LR))?\s*;?$/i.test(firstLine) &&
		!firstLine.includes('{')
	) {
		return 'mermaid-flowchart';
	}
	if (/^sequenceDiagram\b/i.test(firstLine)) return 'mermaid-sequence';
	if (/^stateDiagram/i.test(firstLine)) return 'mermaid-state';
	if (/^classDiagram\b/i.test(firstLine)) return 'mermaid-class';
	if (/^@startuml/i.test(firstLine)) return 'plantuml';
	if (/^(strict\s+)?(di)?graph\b/i.test(firstLine)) return 'dot';
	if (firstLine.startsWith('{')) return 'json';
	return null;
}

export function parseDiagram(source: string, format?: SourceFormat): Diagram {
	if (!source.trim()) throw new ParseError('Paste a diagram to get started');
	const chosen = format ?? detectFormat(source);
	if (!chosen) {
		throw new ParseError(
			'This does not look like a supported diagram. Start with "flowchart LR", "sequenceDiagram", "stateDiagram-v2", "classDiagram", "@startuml", "digraph" or a JSON document.',
			1
		);
	}
	const diagram = PARSERS[chosen](source);
	if (diagram.nodes.length === 0) throw new ParseError('The diagram has no nodes yet');
	return diagram;
}
