import type { Diagram, EdgeStyle } from '../types.ts';
import { DiagramBuilder } from './builder.ts';
import { ParseError, stripFrontmatter } from './shared.ts';

const RELATION =
	/^(\S+)\s*(?:"[^"]*"\s*)?(<\|--|\*--|o--|-->|--\*|--o|--\|>|<--|\.\.>|<\.\.|\.\.\|>|<\|\.\.|--|\.\.)\s*(?:"[^"]*"\s*)?(\S+)\s*(?::\s*(.*))?$/;
const CLASS_OPEN = /^class\s+([^\s{[]+)(?:\s*\["?([^\]"]*)"?\])?\s*(\{)?\s*$/;
const MEMBER = /^(\S+)\s*:\s*(.+)$/;

export function parseClass(source: string): Diagram {
	const builder = new DiagramBuilder('mermaid-class');
	const { body, title, offset } = stripFrontmatter(source);
	if (title) builder.title = title;
	let seenHeader = false;
	let openClass: string | null = null;
	const members = new Map<string, number>();
	const count = (id: string) => members.set(id, (members.get(id) ?? 0) + 1);

	body.split(/\r?\n/).forEach((rawLine, index) => {
		builder.line = index + offset + 1;
		const line = rawLine.trim();
		if (!line) return;
		if (line.startsWith('%%')) {
			builder.directive(line.slice(2));
			return;
		}
		if (!seenHeader) {
			if (/^classDiagram\b/i.test(line)) {
				seenHeader = true;
				return;
			}
			throw new ParseError('A class diagram must start with "classDiagram"', builder.line);
		}
		if (openClass) {
			if (line === '}') openClass = null;
			else if (!line.startsWith('<<')) count(openClass);
			return;
		}
		const namespace = /^namespace\s+(\S+)\s*\{$/.exec(line);
		if (namespace) {
			builder.openGroup(namespace[1], namespace[1]);
			return;
		}
		if (line === '}') {
			if (!builder.closeGroup()) builder.warn('Found "}" with no open namespace');
			return;
		}
		const opened = CLASS_OPEN.exec(line);
		if (opened) {
			builder.node(opened[1], { label: opened[2] || opened[1], kind: 'class', define: true });
			if (opened[3]) openClass = opened[1];
			return;
		}
		const relation = RELATION.exec(line);
		if (relation) {
			const [, left, arrow, right, label] = relation;
			const reversed = arrow.startsWith('<') || arrow === '*--' || arrow === 'o--';
			const from = reversed ? right : left;
			const to = reversed ? left : right;
			builder.node(from, { kind: 'class' });
			builder.node(to, { kind: 'class' });
			const style: EdgeStyle = arrow.includes('..') ? 'dashed' : 'solid';
			builder.edge(from, to, { label: label ?? '', style });
			return;
		}
		if (
			/^(direction|note|link|click|style|cssClass|callback)\b/.test(line) ||
			line.startsWith('<<')
		)
			return;
		const member = MEMBER.exec(line);
		if (member) {
			builder.node(member[1], { kind: 'class' });
			count(member[1]);
			return;
		}
		builder.warn(`Skipped a line Cutaway does not understand: "${line}"`);
	});

	if (!seenHeader) throw new ParseError('A class diagram must start with "classDiagram"');
	for (const [id, total] of members) {
		builder.node(id, { detail: `${total} ${total === 1 ? 'member' : 'members'}` });
	}
	return builder.finish();
}
