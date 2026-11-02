import type { EdgeStyle, NodeKind } from '../types.ts';
import { DiagramBuilder, cleanLabel, slug } from './builder.ts';
import { ParseError, stripFrontmatter } from './shared.ts';

interface Shape {
	open: string;
	close: string[];
	kind?: NodeKind;
}

/** Longest opener first, so "[(" wins over "[" and "((" wins over "(". */
const SHAPES: Shape[] = [
	{ open: '(((', close: [')))'], kind: 'terminal' },
	{ open: '([', close: ['])'] },
	{ open: '[[', close: [']]'], kind: 'function' },
	{ open: '[(', close: [')]'], kind: 'database' },
	{ open: '((', close: ['))'] },
	{ open: '{{', close: ['}}'] },
	{ open: '[/', close: ['/]', '\\]'], kind: 'screen' },
	{ open: '[\\', close: ['\\]', '/]'], kind: 'screen' },
	{ open: '[', close: [']'] },
	{ open: '(', close: [')'] },
	{ open: '{', close: ['}'], kind: 'decision' },
	{ open: '>', close: [']'] }
];

const NEW_SYNTAX_KINDS: Record<string, NodeKind> = {
	cyl: 'database',
	cylinder: 'database',
	database: 'database',
	db: 'database',
	diam: 'decision',
	diamond: 'decision',
	decision: 'decision',
	cloud: 'internet',
	doc: 'storage',
	docs: 'storage',
	bolt: 'function',
	subproc: 'function',
	start: 'terminal',
	stop: 'terminal'
};

const SKIPPED_STATEMENT =
	/^(classDef|class|style|linkStyle|click|accTitle|accDescr|direction|title)\b/;
const HEADER = /^(flowchart|graph)(?:[ \t]+\w+)?$/i;
const PLAIN_ARROW = /(<|[ox](?=[-=]))?(-{2,}|={2,}|-\.+-)(>|[ox](?=\s|$))?/y;
const INLINE_OPEN = /(<|[ox](?=[-=]))?(--|==|-\.)\s*/y;
const INLINE_CLOSE = /(-{2,}|={2,}|\.-+)(>|[ox](?=\s|$))?/y;

class Cursor {
	readonly text: string;
	pos = 0;
	constructor(text: string) {
		this.text = text;
	}
	get done(): boolean {
		return this.pos >= this.text.length;
	}
	skipSpace(): void {
		while (!this.done && /\s/.test(this.text[this.pos])) this.pos++;
	}
	startsWith(token: string): boolean {
		return this.text.startsWith(token, this.pos);
	}
}

function atLink(cursor: Cursor): boolean {
	const two = cursor.text.slice(cursor.pos, cursor.pos + 2);
	if (two === '--' || two === '==' || two === '-.' || two === '~~') return true;
	const three = cursor.text.slice(cursor.pos, cursor.pos + 3);
	return /^[<ox](--|==|-\.)/.test(three);
}

function readId(cursor: Cursor): string {
	const start = cursor.pos;
	while (!cursor.done) {
		const char = cursor.text[cursor.pos];
		if (/[\s&;[\](){}|"]/.test(char) || char === '>' || char === '<') break;
		if (char === ':' && cursor.startsWith(':::')) break;
		if (char === '@' && cursor.startsWith('@{')) break;
		if (cursor.pos > start && (char === '-' || char === '=' || char === '~')) {
			const next = cursor.text[cursor.pos + 1];
			if (next === '-' || next === '=' || next === '.' || next === '~') break;
		}
		cursor.pos++;
	}
	return cursor.text.slice(start, cursor.pos);
}

function readUntil(cursor: Cursor, closers: string[]): string | null {
	let out = '';
	while (!cursor.done) {
		if (cursor.text[cursor.pos] === '"') {
			const end = cursor.text.indexOf('"', cursor.pos + 1);
			if (end === -1) return null;
			out += cursor.text.slice(cursor.pos + 1, end);
			cursor.pos = end + 1;
			continue;
		}
		for (const closer of closers) {
			if (cursor.startsWith(closer)) {
				cursor.pos += closer.length;
				return out;
			}
		}
		out += cursor.text[cursor.pos++];
	}
	return null;
}

function parseNode(cursor: Cursor, builder: DiagramBuilder): string {
	cursor.skipSpace();
	const id = readId(cursor);
	if (!id)
		throw new ParseError(
			`Expected a node id near "${cursor.text.slice(cursor.pos, cursor.pos + 16)}"`
		);

	const shape = SHAPES.find((candidate) => cursor.startsWith(candidate.open));
	if (shape) {
		cursor.pos += shape.open.length;
		const label = readUntil(cursor, shape.close);
		if (label === null)
			throw new ParseError(`Node "${id}" opens "${shape.open}" but never closes it`);
		builder.node(id, { label, shapeKind: shape.kind, define: true });
	} else if (cursor.startsWith('@{')) {
		const end = cursor.text.indexOf('}', cursor.pos);
		if (end === -1) throw new ParseError(`Node "${id}" opens "@{" but never closes it`);
		const body = cursor.text.slice(cursor.pos + 2, end);
		cursor.pos = end + 1;
		const shapeName = /shape\s*:\s*"?([\w-]+)"?/.exec(body)?.[1];
		const label = /label\s*:\s*"([^"]*)"/.exec(body)?.[1];
		builder.node(id, {
			label,
			shapeKind: shapeName ? NEW_SYNTAX_KINDS[shapeName] : undefined,
			define: true
		});
	} else {
		builder.node(id);
	}
	if (cursor.startsWith(':::')) {
		cursor.pos += 3;
		readId(cursor);
	}
	return id;
}

function parseNodeGroup(cursor: Cursor, builder: DiagramBuilder): string[] {
	const ids = [parseNode(cursor, builder)];
	cursor.skipSpace();
	while (cursor.startsWith('&')) {
		cursor.pos++;
		ids.push(parseNode(cursor, builder));
		cursor.skipSpace();
	}
	return ids;
}

interface Link {
	label: string;
	style: EdgeStyle;
	crossed: boolean;
	directed: boolean;
	both: boolean;
	invisible: boolean;
}

function styleOf(body: string): EdgeStyle {
	if (body.startsWith('=')) return 'thick';
	if (body.includes('.')) return 'dashed';
	return 'solid';
}

function parseLink(cursor: Cursor): Link | null {
	cursor.skipSpace();
	const tilde = /~{3,}/y;
	tilde.lastIndex = cursor.pos;
	if (tilde.test(cursor.text)) {
		cursor.pos = tilde.lastIndex;
		return {
			label: '',
			style: 'solid',
			crossed: false,
			directed: false,
			both: false,
			invisible: true
		};
	}

	PLAIN_ARROW.lastIndex = cursor.pos;
	const plain = PLAIN_ARROW.exec(cursor.text);
	if (plain && (plain[3] || plain[2].length >= 3)) {
		cursor.pos = PLAIN_ARROW.lastIndex;
		const link: Link = {
			label: '',
			style: styleOf(plain[2]),
			crossed: plain[3] === 'x',
			directed: Boolean(plain[3]),
			both: plain[1] === '<',
			invisible: false
		};
		cursor.skipSpace();
		if (cursor.startsWith('|')) {
			cursor.pos++;
			link.label = readUntil(cursor, ['|']) ?? '';
		}
		return link;
	}

	INLINE_OPEN.lastIndex = cursor.pos;
	const inline = INLINE_OPEN.exec(cursor.text);
	if (inline) {
		cursor.pos = INLINE_OPEN.lastIndex;
		let label = '';
		while (!cursor.done) {
			INLINE_CLOSE.lastIndex = cursor.pos;
			const close = INLINE_CLOSE.exec(cursor.text);
			if (close && (close[2] || close[1].length >= 3)) {
				cursor.pos = INLINE_CLOSE.lastIndex;
				return {
					label: label.trim().replace(/^"|"$/g, ''),
					style: styleOf(inline[2]),
					crossed: close[2] === 'x',
					directed: Boolean(close[2]),
					both: inline[1] === '<',
					invisible: false
				};
			}
			label += cursor.text[cursor.pos++];
		}
		throw new ParseError(`The label "${label.trim()}" has no closing arrow`);
	}
	return null;
}

function parseStatement(text: string, builder: DiagramBuilder): void {
	const cursor = new Cursor(text);
	let sources = parseNodeGroup(cursor, builder);
	cursor.skipSpace();
	const pairs: { from: string; to: string; link: Link }[] = [];
	while (!cursor.done) {
		if (!atLink(cursor)) {
			throw new ParseError(`Unexpected text "${cursor.text.slice(cursor.pos, cursor.pos + 20)}"`);
		}
		const link = parseLink(cursor);
		if (!link) {
			throw new ParseError(
				`Could not read the arrow at "${cursor.text.slice(cursor.pos, cursor.pos + 12)}"`
			);
		}
		const targets = parseNodeGroup(cursor, builder);
		if (!link.invisible) {
			for (const from of sources) for (const to of targets) pairs.push({ from, to, link });
		}
		sources = targets;
		cursor.skipSpace();
	}
	const fansOut = pairs.length > 1 && new Set(pairs.map((pair) => pair.link)).size < pairs.length;
	if (fansOut) builder.beginParallel();
	for (const { from, to, link } of pairs) {
		builder.edge(from, to, {
			label: link.label,
			style: link.style,
			crossed: link.crossed,
			directed: link.directed || link.both
		});
	}
	if (fansOut) builder.endParallel();
}

function splitStatements(line: string): string[] {
	const out: string[] = [];
	let current = '';
	let quoted = false;
	for (const char of line) {
		if (char === '"') quoted = !quoted;
		if (char === ';' && !quoted) {
			out.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	out.push(current);
	return out.map((part) => part.trim()).filter(Boolean);
}

function parseSubgraph(rest: string, builder: DiagramBuilder): void {
	const text = rest.trim();
	const bracketed = /^([^\s[]+)\s*\[\s*"?([^\]"]*)"?\s*\]$/.exec(text);
	if (bracketed) {
		builder.openGroup(bracketed[1], cleanLabel(bracketed[2]).label);
		return;
	}
	const quoted = /^"([^"]*)"$/.exec(text);
	const title = quoted ? quoted[1] : text;
	const id = /^[\w-]+$/.test(title) ? title : slug(title);
	builder.openGroup(id, cleanLabel(title).label);
}

export function parseFlowchart(source: string): ReturnType<DiagramBuilder['finish']> {
	const builder = new DiagramBuilder('mermaid-flowchart');
	const { body, title, offset } = stripFrontmatter(source);
	if (title) builder.title = title;
	const lines = body.split(/\r?\n/);
	let seenHeader = false;

	lines.forEach((rawLine, index) => {
		builder.line = index + offset + 1;
		const trimmed = rawLine.trim();
		if (!trimmed) return;
		if (trimmed.startsWith('%%')) {
			builder.directive(trimmed.slice(2));
			return;
		}
		const line = trimmed.replace(/\s%%.*$/, '');
		for (const statement of splitStatements(line)) {
			if (!seenHeader) {
				if (HEADER.test(statement)) {
					seenHeader = true;
					continue;
				}
				throw new ParseError('A flowchart must start with "flowchart" or "graph"', builder.line);
			}
			if (/^subgraph\b/.test(statement)) {
				parseSubgraph(statement.slice('subgraph'.length), builder);
			} else if (statement === 'end') {
				if (!builder.closeGroup()) builder.warn('Found "end" with no open subgraph');
			} else if (!SKIPPED_STATEMENT.test(statement)) {
				try {
					parseStatement(statement, builder);
				} catch (error) {
					if (error instanceof ParseError) throw new ParseError(error.message, builder.line);
					throw error;
				}
			}
		}
	});

	if (builder.depth > 0) builder.warn('A subgraph is missing its "end"');
	return builder.finish();
}
