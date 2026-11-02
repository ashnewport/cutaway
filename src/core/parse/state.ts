import type { Diagram } from '../types.ts';
import { DiagramBuilder } from './builder.ts';
import { ParseError, stripFrontmatter } from './shared.ts';

const TRANSITION = /^(\[\*\]|[^\s:]+)\s*(-{2,}>)\s*(\[\*\]|[^\s:]+)\s*(?::\s*(.*))?$/;
const DESCRIBED = /^state\s+"([^"]+)"\s+as\s+(\S+)(?:\s*\{)?$/;
const COMPOSITE = /^state\s+(\S+)\s*\{$/;
const STEREOTYPE = /^state\s+(\S+)\s+<<(\w+)>>$/;
const DESCRIPTION = /^([^\s:]+)\s*:\s*(.+)$/;
const SKIPPED = /^(direction|classDef|class|accTitle|accDescr|--$|note\b|end note)/;

export function parseState(source: string): Diagram {
	const builder = new DiagramBuilder('mermaid-state');
	const { body, title, offset } = stripFrontmatter(source);
	if (title) builder.title = title;
	let seenHeader = false;
	let inNote = false;
	const scope: string[] = ['root'];

	const pseudo = (position: 'start' | 'end'): string => {
		const id = `${scope[scope.length - 1]}__${position}`;
		builder.node(id, {
			label: position === 'start' ? 'Start' : 'End',
			kind: 'terminal',
			define: true
		});
		return id;
	};

	body.split(/\r?\n/).forEach((rawLine, index) => {
		builder.line = index + offset + 1;
		const line = rawLine.trim();
		if (!line) return;
		if (line.startsWith('%%')) {
			builder.directive(line.slice(2));
			return;
		}
		if (!seenHeader) {
			if (/^stateDiagram(-v2)?\b/i.test(line)) {
				seenHeader = true;
				return;
			}
			throw new ParseError('A state diagram must start with "stateDiagram-v2"', builder.line);
		}
		if (inNote) {
			if (/^end note/.test(line)) inNote = false;
			return;
		}
		if (/^note\b/.test(line)) {
			const inline = /^note\s+[^:]+:\s*(.*)$/.exec(line);
			if (inline) builder.note(inline[1]);
			else inNote = true;
			return;
		}

		const transition = TRANSITION.exec(line);
		if (transition) {
			const [, fromRaw, , toRaw, label] = transition;
			const from = fromRaw === '[*]' ? pseudo('start') : declare(builder, fromRaw);
			const to = toRaw === '[*]' ? pseudo('end') : declare(builder, toRaw);
			builder.edge(from, to, { label: label ?? '' });
			return;
		}

		const described = DESCRIBED.exec(line);
		if (described) {
			if (line.endsWith('{')) {
				builder.openGroup(described[2], described[1]);
				scope.push(described[2]);
			} else {
				builder.node(described[2], { label: described[1], kind: 'state', define: true });
			}
			return;
		}

		const composite = COMPOSITE.exec(line);
		if (composite) {
			builder.openGroup(composite[1], composite[1]);
			scope.push(composite[1]);
			return;
		}

		const stereotype = STEREOTYPE.exec(line);
		if (stereotype) {
			const decision = stereotype[2] === 'choice';
			builder.node(stereotype[1], {
				kind: decision ? 'decision' : 'state',
				define: true,
				label: decision ? stereotype[1].replace(/_/g, ' ') : undefined
			});
			return;
		}

		if (line === '}') {
			if (scope.length > 1) scope.pop();
			if (!builder.closeGroup()) builder.warn('Found "}" with no open state');
			return;
		}

		if (SKIPPED.test(line)) return;

		const description = DESCRIPTION.exec(line);
		if (description) {
			builder.node(description[1], { label: description[2], kind: 'state', define: true });
			return;
		}
		if (/^\S+$/.test(line)) {
			declare(builder, line);
			return;
		}
		builder.warn(`Skipped a line Cutaway does not understand: "${line}"`);
	});

	if (!seenHeader) throw new ParseError('A state diagram must start with "stateDiagram-v2"');
	return builder.finish();
}

function declare(builder: DiagramBuilder, id: string): string {
	const known = builder.has(id);
	builder.node(id, { kind: 'state', define: !known });
	return id;
}
