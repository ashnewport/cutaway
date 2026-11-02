import type { Diagram, EdgeStyle, NodeKind } from '../types.ts';
import { DiagramBuilder, slug } from './builder.ts';
import { ParseError } from './shared.ts';

const DECLARATION_KINDS: Record<string, NodeKind | undefined> = {
	actor: 'actor',
	participant: undefined,
	boundary: 'gateway',
	control: 'service',
	entity: 'service',
	database: 'database',
	collections: 'storage',
	queue: 'queue',
	component: 'service',
	interface: 'gateway',
	usecase: 'screen',
	storage: 'storage',
	agent: 'service'
};

const DECLARATION =
	/^(actor|participant|boundary|control|entity|database|collections|queue|component|interface|usecase|storage|agent)\s+(?:"([^"]+)"\s+as\s+(\S+)|(\S+)\s+as\s+"([^"]+)"|"([^"]+)"|(\S+))(?:\s+<<[^>]+>>)?(?:\s+#\w+)?\s*(\{)?\s*$/;
const COMPONENT = /^\[([^\]]+)\](?:\s+as\s+(\S+))?$/;
const GROUP =
	/^(package|frame|node|cloud|rectangle|folder)\s+(?:"([^"]+)"|(\S+))(?:\s+as\s+\S+)?(?:\s+<<[^>]+>>)?(?:\s+#\w+)?\s*\{$/;
const BOX = /^box\s*(?:"([^"]+)"|([^#]*))?(?:\s*#\w+)?\s*$/;
const ARROW =
	/^(.+?)\s*(<<?-+|<<?\.+|<?-+(?:\[[^\]]*\]-*)?(?:left|right|up|down)?-*>?>?|<?\.+(?:left|right|up|down)?\.*>?>?|-+x|x-+)\s*(.+?)\s*(?::\s*(.*))?$/;
const NOTE = /^note\s+(?:over|left of|right of|left|right)\b[^:]*:\s*(.*)$/i;
const NOTE_BLOCK = /^(r|h)?note\s+(over|left|right)\b/i;
const SKIP =
	/^(skinparam|autonumber|hide|show|scale|skin|!|activate|deactivate|destroy|return|newpage|header|footer|legend|end legend|left to right|top to bottom|'|\/')/i;
const FLOW_OPEN = /^(alt|opt|loop|par|break|critical|group)\b\s*(.*)$/;

function ref(raw: string): string {
	const text = raw.trim();
	const component = COMPONENT.exec(text);
	if (component) return component[2] ?? component[1];
	return text.replace(/^"|"$/g, '').replace(/\s*[+-]{1,2}$/, '');
}

export function parsePlantuml(source: string): Diagram {
	const builder = new DiagramBuilder('plantuml');
	let inNote = false;
	const scopes: ('group' | 'flow' | 'box')[] = [];
	let seenStart = false;

	source.split(/\r?\n/).forEach((rawLine, index) => {
		builder.line = index + 1;
		const line = rawLine.trim();
		if (!line) return;
		if (line.startsWith("'")) {
			builder.directive(line.slice(1));
			return;
		}
		if (line.startsWith('@startuml')) {
			seenStart = true;
			return;
		}
		if (line.startsWith('@enduml')) return;
		if (inNote) {
			if (/^end\s*(note|rnote|hnote)/i.test(line)) inNote = false;
			else builder.note(line);
			return;
		}

		const title = /^title\s+(.+)$/i.exec(line);
		if (title) {
			builder.title = title[1].trim();
			return;
		}

		const note = NOTE.exec(line);
		if (note) {
			builder.note(note[1]);
			return;
		}
		if (NOTE_BLOCK.test(line)) {
			inNote = true;
			return;
		}

		const box = /^box\b/i.test(line) ? BOX.exec(line) : null;
		if (box) {
			const text = (box[1] ?? box[2] ?? '').trim() || 'Group';
			builder.openGroup(slug(text), text);
			scopes.push('box');
			return;
		}
		if (/^end\s*box$/i.test(line)) {
			scopes.pop();
			builder.closeGroup();
			return;
		}

		const group = GROUP.exec(line);
		if (group) {
			const text = group[2] ?? group[3];
			builder.openGroup(slug(text), text);
			scopes.push('group');
			return;
		}
		if (line === '}') {
			scopes.pop();
			if (!builder.closeGroup()) builder.warn('Found "}" with no open group');
			return;
		}

		const flow = FLOW_OPEN.exec(line);
		if (flow) {
			scopes.push('flow');
			return;
		}
		if (/^else\b/.test(line)) return;
		if (/^end$/i.test(line)) {
			scopes.pop();
			return;
		}

		const declaration = DECLARATION.exec(line);
		if (declaration) {
			const [, keyword, quotedLabel, quotedId, bareId, bareLabel, onlyQuoted, onlyBare] =
				declaration;
			const id = quotedId ?? bareId ?? onlyQuoted ?? onlyBare;
			const label = quotedLabel ?? bareLabel ?? onlyQuoted ?? onlyBare;
			builder.node(id, { label, kind: DECLARATION_KINDS[keyword], define: true });
			return;
		}

		const component = COMPONENT.exec(line);
		if (component) {
			builder.node(component[2] ?? component[1], { label: component[1], define: true });
			return;
		}

		if (SKIP.test(line)) return;

		const arrow = ARROW.exec(line);
		if (arrow && /[-.]/.test(arrow[2])) {
			const [, left, shaft, right, label] = arrow;
			const reversed = shaft.startsWith('<') && !shaft.endsWith('>');
			const crossed = shaft.includes('x');
			const style: EdgeStyle = shaft.includes('.') || /^<?--/.test(shaft) ? 'dashed' : 'solid';
			const a = ref(left);
			const b = ref(right);
			declareBareComponent(builder, left);
			declareBareComponent(builder, right);
			builder.edge(reversed ? b : a, reversed ? a : b, { label: label ?? '', style, crossed });
			return;
		}

		builder.warn(`Skipped a line Cutaway does not understand: "${line}"`);
	});

	if (!seenStart && builder.warnings.length > 0) {
		throw new ParseError('PlantUML source should start with "@startuml"');
	}
	return builder.finish();
}

function declareBareComponent(builder: DiagramBuilder, raw: string): void {
	const component = COMPONENT.exec(raw.trim());
	if (component) builder.node(component[2] ?? component[1], { label: component[1], define: true });
}
