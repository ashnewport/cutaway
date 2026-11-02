import type { Diagram, EdgeStyle, NodeKind } from '../types.ts';
import { DiagramBuilder, slug } from './builder.ts';
import { ParseError } from './shared.ts';

type Token = { type: 'id' | 'symbol'; value: string; line: number };

const SHAPE_KINDS: Record<string, NodeKind> = {
	cylinder: 'database',
	diamond: 'decision',
	folder: 'storage',
	cds: 'queue',
	component: 'service',
	doublecircle: 'terminal',
	circle: 'state',
	house: 'gateway',
	box3d: 'service'
};

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let pos = 0;
	let line = 1;
	while (pos < source.length) {
		const char = source[pos];
		if (char === '\n') {
			line++;
			pos++;
		} else if (/\s/.test(char)) {
			pos++;
		} else if (source.startsWith('//', pos) || char === '#') {
			const end = source.indexOf('\n', pos);
			pos = end === -1 ? source.length : end;
		} else if (source.startsWith('/*', pos)) {
			const end = source.indexOf('*/', pos);
			const stop = end === -1 ? source.length : end + 2;
			line += source.slice(pos, stop).split('\n').length - 1;
			pos = stop;
		} else if (char === '"') {
			let value = '';
			pos++;
			while (pos < source.length && source[pos] !== '"') {
				if (source[pos] === '\\' && source[pos + 1] === '"') pos++;
				if (source[pos] === '\n') line++;
				value += source[pos++];
			}
			pos++;
			tokens.push({ type: 'id', value, line });
		} else if (source.startsWith('->', pos) || source.startsWith('--', pos)) {
			tokens.push({ type: 'symbol', value: source.slice(pos, pos + 2), line });
			pos += 2;
		} else if (/[{}[\];,=:]/.test(char)) {
			tokens.push({ type: 'symbol', value: char, line });
			pos++;
		} else {
			const start = pos;
			while (pos < source.length && !/[\s{}[\];,=:"]/.test(source[pos])) {
				if (source.startsWith('->', pos) || source.startsWith('--', pos)) break;
				pos++;
			}
			if (pos === start) throw new ParseError(`Unexpected character "${char}"`, line);
			tokens.push({ type: 'id', value: source.slice(start, pos), line });
		}
	}
	return tokens;
}

export function parseDot(source: string): Diagram {
	const builder = new DiagramBuilder('dot');
	const directives = extractDirectives(source);
	const tokens = tokenize(directives.source);
	let pos = 0;
	const peek = (offset = 0): Token | undefined => tokens[pos + offset];
	const is = (value: string): boolean => peek()?.type === 'symbol' && peek()?.value === value;
	const flushDirectives = (line: number): void => {
		while (directives.list.length > 0 && directives.list[0].line <= line) {
			const entry = directives.list.shift();
			if (entry) builder.directive(entry.text);
		}
	};

	const readAttrs = (): Record<string, string> => {
		const attrs: Record<string, string> = {};
		while (is('[')) {
			pos++;
			while (pos < tokens.length && !is(']')) {
				const key = tokens[pos++];
				if (key.type === 'symbol') continue;
				if (is('=')) {
					pos++;
					attrs[key.value] = tokens[pos++]?.value ?? '';
				}
			}
			pos++;
		}
		return attrs;
	};

	const applyNodeAttrs = (id: string, attrs: Record<string, string>, define: boolean): void => {
		builder.node(id, {
			label: attrs.label,
			shapeKind: attrs.shape ? SHAPE_KINDS[attrs.shape] : undefined,
			define
		});
	};

	const readStatements = (): void => {
		while (pos < tokens.length && !is('}')) {
			const token = peek();
			if (!token) return;
			builder.line = token.line;
			flushDirectives(token.line);
			if (is(';') || is(',')) {
				pos++;
				continue;
			}
			if (token.type === 'id' && /^subgraph$/i.test(token.value)) {
				pos++;
				let name = '';
				if (peek()?.type === 'id') name = tokens[pos++].value;
				if (is('{')) {
					pos++;
					const group = name.replace(/^cluster_?/, '') || 'group';
					builder.openGroup(slug(group), group);
					readStatements();
					pos++;
					builder.closeGroup();
				}
				continue;
			}
			if (
				token.type === 'id' &&
				/^(node|edge|graph)$/i.test(token.value) &&
				peek(1)?.value === '['
			) {
				pos++;
				readAttrs();
				continue;
			}
			if (token.type === 'id' && peek(1)?.value === '=') {
				const value = peek(2)?.value ?? '';
				if (token.value === 'label') builder.renameCurrent(value);
				pos += 3;
				continue;
			}
			if (token.type !== 'id') {
				throw new ParseError(`Unexpected "${token.value}"`, token.line);
			}
			const chain = [tokens[pos++].value];
			let directed = true;
			while (is('->') || is('--')) {
				if (is('--')) directed = false;
				pos++;
				const next = peek();
				if (next?.type !== 'id') throw new ParseError('An edge needs a target', token.line);
				chain.push(next.value);
				pos++;
			}
			const attrs = readAttrs();
			const style = attrs.style ?? '';
			if (chain.length === 1) {
				applyNodeAttrs(chain[0], attrs, true);
			} else {
				const edgeStyle: EdgeStyle =
					style === 'dashed' || style === 'dotted'
						? 'dashed'
						: style === 'bold'
							? 'thick'
							: 'solid';
				for (let index = 0; index < chain.length - 1; index++) {
					builder.edge(chain[index], chain[index + 1], {
						label: attrs.label,
						style: edgeStyle,
						directed
					});
				}
			}
		}
	};

	if (peek()?.value.toLowerCase() === 'strict') pos++;
	const header = peek();
	if (header?.type !== 'id' || !/^(di)?graph$/i.test(header.value)) {
		throw new ParseError('A DOT file must start with "digraph" or "graph"', header?.line ?? 1);
	}
	pos++;
	if (peek()?.type === 'id') builder.title = tokens[pos++].value;
	if (!is('{')) throw new ParseError('Expected "{" after the graph name', peek()?.line ?? 1);
	pos++;
	readStatements();
	flushDirectives(Number.POSITIVE_INFINITY);
	return builder.finish();
}

/** Pulls "// @..." lines out first, so they can be replayed in source order among the edges. */
function extractDirectives(source: string): {
	source: string;
	list: { line: number; text: string }[];
} {
	const list: { line: number; text: string }[] = [];
	const cleaned = source
		.split('\n')
		.map((line, index) => {
			const match = /^\s*(?:\/\/|#)\s*(@.*)$/.exec(line);
			if (!match) return line;
			list.push({ line: index + 1, text: match[1] });
			return '';
		})
		.join('\n');
	return { source: cleaned, list };
}
