import type { Diagram, EdgeStyle, NodeKind } from '../types.ts';
import { DiagramBuilder, slug } from './builder.ts';
import { ParseError, stripFrontmatter } from './shared.ts';

const MESSAGE =
	/^(.+?)\s*(<<-->>|<<->>|--?>>|--?>|--?x|--?\)|-\\\\|-\/\/)\s*([+-]?)\s*(.+?)\s*:\s*(.*)$/;
const NOTE = /^note\s+(?:over|left of|right of)\s+[^:]+:\s*(.*)$/i;
const BLOCK_OPEN = /^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/;
const BLOCK_NEXT = /^(else|and|option)\b\s*(.*)$/;
const IGNORED =
	/^(autonumber|activate|deactivate|destroy|link|links|properties|details|accTitle|accDescr)\b/;

function readParticipant(rest: string): { id: string; label: string } {
	const alias = /^(.+?)\s+as\s+(.+)$/.exec(rest.trim());
	if (alias) return { id: alias[1].trim(), label: alias[2].trim() };
	return { id: rest.trim(), label: rest.trim() };
}

export function parseSequence(source: string): Diagram {
	const builder = new DiagramBuilder('mermaid-sequence');
	const { body, title, offset } = stripFrontmatter(source);
	if (title) builder.title = title;

	interface OpenBlock {
		type: string;
		label: string;
		kind: 'box' | 'flow';
	}
	const blocks: OpenBlock[] = [];
	let seenHeader = false;

	body.split(/\r?\n/).forEach((rawLine, index) => {
		builder.line = index + offset + 1;
		const line = rawLine.trim();
		if (!line) return;
		if (line.startsWith('%%')) {
			builder.directive(line.slice(2));
			return;
		}
		if (!seenHeader) {
			if (/^sequenceDiagram\b/i.test(line)) {
				seenHeader = true;
				return;
			}
			throw new ParseError('A sequence diagram must start with "sequenceDiagram"', builder.line);
		}

		const titled = /^title:?\s+(.+)$/.exec(line);
		if (titled) {
			builder.title = titled[1];
			return;
		}

		const participant = /^(?:create\s+)?(participant|actor)\s+(.+)$/.exec(line);
		if (participant) {
			const { id, label } = readParticipant(participant[2]);
			const kind: NodeKind | undefined = participant[1] === 'actor' ? 'actor' : undefined;
			builder.node(id, { label, kind, define: true });
			return;
		}

		const box = /^box\b\s*(.*)$/.exec(line);
		if (box) {
			const text = box[1]
				.replace(/^(transparent|aqua|rgba?\([^)]*\)|#[0-9a-f]{3,8})\s*/i, '')
				.replace(/^(red|blue|green|purple|grey|gray|yellow|orange|pink)\s+/i, '');
			builder.openGroup(slug(text, 'box'), text);
			blocks.push({ type: 'box', label: text, kind: 'box' });
			return;
		}

		const opened = BLOCK_OPEN.exec(line);
		if (opened) {
			blocks.push({ type: opened[1], label: opened[2], kind: 'flow' });
			if (opened[1] === 'par') builder.beginParallel();
			return;
		}

		const next = BLOCK_NEXT.exec(line);
		if (next) {
			const top = blocks[blocks.length - 1];
			if (top) top.label = next[2];
			return;
		}

		if (line === 'end') {
			const top = blocks.pop();
			if (!top) builder.warn('Found "end" with no open block');
			else if (top.kind === 'box') builder.closeGroup();
			else if (top.type === 'par') builder.endParallel();
			return;
		}

		const note = NOTE.exec(line);
		if (note) {
			builder.note(note[1]);
			return;
		}

		if (IGNORED.test(line)) return;

		const message = MESSAGE.exec(line);
		if (message) {
			const [, from, arrow, , to, text] = message;
			const style: EdgeStyle =
				arrow.startsWith('--') || arrow.startsWith('<<--') ? 'dashed' : 'solid';
			builder.edge(from.trim(), to.trim(), {
				label: text,
				style,
				crossed: arrow.endsWith('x')
			});
			// Guards (alt, opt, loop) become context on the caption, not a new step.
			const guard = [...blocks]
				.reverse()
				.find((block) => block.kind === 'flow' && block.type !== 'par' && block.label);
			if (guard) builder.note(`${capitalise(guard.type)}: ${guard.label}.`);
			return;
		}

		builder.warn(`Skipped a line Cutaway does not understand: "${line}"`);
	});

	if (!seenHeader) throw new ParseError('A sequence diagram must start with "sequenceDiagram"');
	if (blocks.length > 0) builder.warn(`"${blocks[blocks.length - 1].type}" is missing its "end"`);
	return builder.finish();
}

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
