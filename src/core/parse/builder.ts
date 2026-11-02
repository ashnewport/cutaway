import { inferKind, inferPayload, tierForKind, TIERS } from '../kinds.ts';
import type {
	Diagram,
	DiagramEdge,
	DiagramLayer,
	DiagramNode,
	DiagramStep,
	DiagramZone,
	EdgeStyle,
	NodeKind,
	SourceFormat,
	Warning
} from '../types.ts';

interface Group {
	id: string;
	title: string;
	parent: Group | null;
}

interface PendingNode {
	id: string;
	label: string;
	detail: string;
	kind: NodeKind | null;
	shapeKind: NodeKind | null;
	group: Group | null;
	defined: boolean;
}

export interface NodeInit {
	label?: string;
	detail?: string;
	/** A kind the author chose outright. Beats inference. */
	kind?: NodeKind;
	/** A hint from the source shape. Keywords in the label can still refine it. */
	shapeKind?: NodeKind;
	/** True when the source declares the node here, rather than merely mentioning its id. */
	define?: boolean;
}

export interface EdgeInit {
	label?: string;
	style?: EdgeStyle;
	crossed?: boolean;
	directed?: boolean;
}

const ZONE_DIRECTIVE = /^(\S+?)(?:\s+in\s+(\S+?))?\s+(?:"([^"]+)"|([^:]+?))\s*:\s*(.+)$/;

const NODE_KINDS = new Set<NodeKind>([
	'actor',
	'screen',
	'service',
	'function',
	'database',
	'storage',
	'cache',
	'queue',
	'gateway',
	'loadbalancer',
	'internet',
	'cdn',
	'dns',
	'firewall',
	'auth',
	'secret',
	'decision',
	'state',
	'class',
	'terminal'
]);

export function cleanLabel(raw: string): { label: string; detail: string } {
	const parts = raw
		.replace(/^["'`]+|["'`]+$/g, '')
		.replace(/\\n/g, '\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/fa:fa-[\w-]+\s*/g, '')
		.split('\n')
		.map((part) => part.trim())
		.filter(Boolean);
	return { label: parts[0] ?? '', detail: parts.slice(1).join(' ') };
}

export function slug(text: string, fallback = 'group'): string {
	const id = text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '_')
		.replace(/^_+|_+$/g, '');
	return id || fallback;
}

/** Collects what a parser finds, then decides which groups are plates and which are zones. */
export class DiagramBuilder {
	title = '';
	readonly format: SourceFormat;
	readonly warnings: Warning[] = [];
	line: number | null = null;

	private readonly nodes = new Map<string, PendingNode>();
	private readonly groups = new Map<string, Group>();
	private readonly edges: DiagramEdge[] = [];
	private readonly steps: DiagramStep[] = [];
	private readonly kindOverrides = new Map<string, NodeKind>();
	private readonly detailOverrides = new Map<string, string>();
	private readonly groupAssignments: { node: string; group: string }[] = [];
	private current: Group | null = null;
	private openStep: DiagramStep | null = null;
	private stepOpenedByDirective = false;
	private flatGroups = false;
	private autoLayer = true;

	constructor(format: SourceFormat) {
		this.format = format;
	}

	warn(message: string): void {
		this.warnings.push({ line: this.line, message });
	}

	/** Returns true when the comment text was a Cutaway directive. */
	directive(comment: string): boolean {
		const match = /^@(\w+)\s*(.*)$/.exec(comment.trim());
		if (!match) return false;
		const [, name, rest] = match;
		const args = rest.trim();
		switch (name.toLowerCase()) {
			case 'title':
				this.title = args;
				return true;
			case 'step':
				this.beginStep(args);
				return true;
			case 'endstep':
				this.closeStep();
				return true;
			case 'kind': {
				const [id, kind] = args.split(/\s+/);
				if (id && NODE_KINDS.has(kind as NodeKind)) this.kindOverrides.set(id, kind as NodeKind);
				else this.warn(`@kind needs a node id and a known kind, but got "${args}"`);
				return true;
			}
			case 'detail': {
				const space = args.search(/\s/);
				if (space > 0) this.detailOverrides.set(args.slice(0, space), args.slice(space + 1).trim());
				return true;
			}
			case 'layers':
				this.flatGroups = args === 'off';
				return true;
			case 'autolayer':
				this.autoLayer = args !== 'off';
				return true;
			case 'zone': {
				const zone = ZONE_DIRECTIVE.exec(args);
				if (!zone) {
					this.warn(`@zone expects: id [in parent] "Title": node, node. Got "${args}"`);
					return true;
				}
				const [, id, parentId, quoted, bare, members] = zone;
				this.defineGroup(id, quoted ?? bare, parentId ?? null);
				for (const node of members.split(',').map((part) => part.trim())) {
					if (node) this.groupAssignments.push({ node, group: id });
				}
				return true;
			}
			default:
				return false;
		}
	}

	private defineGroup(id: string, title: string, parentId: string | null): Group {
		const existing = this.groups.get(id);
		if (existing) {
			if (title) existing.title = title;
			if (parentId) existing.parent = this.requireGroup(parentId);
			return existing;
		}
		const group: Group = {
			id,
			title: title || id,
			parent: parentId ? this.requireGroup(parentId) : null
		};
		this.groups.set(id, group);
		return group;
	}

	private requireGroup(id: string): Group {
		return this.groups.get(id) ?? this.defineGroup(id, id, null);
	}

	openGroup(id: string, title: string): void {
		let unique = id;
		for (let suffix = 2; this.groups.has(unique); suffix++) unique = `${id}_${suffix}`;
		const group: Group = { id: unique, title: title || id, parent: this.current };
		this.groups.set(unique, group);
		this.current = group;
	}

	/** Sets the open group's title, or the diagram's when no group is open. */
	renameCurrent(title: string): void {
		if (this.current) this.current.title = title;
		else this.title = title;
	}

	closeGroup(): boolean {
		if (!this.current) return false;
		this.current = this.current.parent;
		return true;
	}

	get depth(): number {
		let depth = 0;
		for (let group = this.current; group; group = group.parent) depth++;
		return depth;
	}

	node(id: string, init: NodeInit = {}): string {
		let node = this.nodes.get(id);
		if (!node) {
			node = {
				id,
				label: id,
				detail: '',
				kind: null,
				shapeKind: null,
				group: this.current,
				defined: false
			};
			this.nodes.set(id, node);
		}
		if (init.label !== undefined) {
			const { label, detail } = cleanLabel(init.label);
			if (label) node.label = label;
			if (detail) node.detail = detail;
		}
		if (init.detail) node.detail = init.detail;
		if (init.kind) node.kind = init.kind;
		if (init.shapeKind) node.shapeKind = init.shapeKind;
		if (init.define && !node.defined) {
			node.group = this.current;
			node.defined = true;
		}
		return id;
	}

	beginStep(caption: string): void {
		this.closeStep();
		this.openStep = {
			id: `s${this.steps.length + 1}`,
			title: '',
			caption: caption.trim(),
			edges: []
		};
		this.stepOpenedByDirective = true;
	}

	closeStep(): void {
		if (this.openStep && this.openStep.edges.length > 0) this.steps.push(this.openStep);
		else if (this.openStep?.caption) this.warn(`Step "${this.openStep.caption}" has no edges`);
		this.openStep = null;
		this.stepOpenedByDirective = false;
	}

	/** Starts a parser-owned group of parallel edges, unless an author's @step already holds one. */
	beginParallel(): void {
		if (this.stepOpenedByDirective) return;
		this.closeStep();
		this.openStep = { id: `s${this.steps.length + 1}`, title: '', caption: '', edges: [] };
	}

	endParallel(): void {
		if (!this.stepOpenedByDirective) this.closeStep();
	}

	edge(from: string, to: string, init: EdgeInit = {}): DiagramEdge {
		const { label } = cleanLabel(init.label ?? '');
		const edge: DiagramEdge = {
			id: `e${this.edges.length + 1}`,
			from: this.node(from),
			to: this.node(to),
			label,
			style: init.style ?? 'solid',
			payload: inferPayload(label, init.crossed ?? false),
			directed: init.directed ?? true
		};
		this.edges.push(edge);
		if (this.openStep) {
			this.openStep.edges.push(edge.id);
		} else {
			this.steps.push({
				id: `s${this.steps.length + 1}`,
				title: '',
				caption: '',
				edges: [edge.id]
			});
		}
		return edge;
	}

	/** Attaches note text to the latest step, or to the one being assembled. */
	note(text: string): void {
		const target = this.openStep ?? this.steps[this.steps.length - 1];
		const { label, detail } = cleanLabel(text);
		const clean = [label, detail].filter(Boolean).join(' ');
		if (!clean) return;
		if (target) target.caption = target.caption ? `${target.caption} ${clean}` : clean;
		else this.beginStep(clean);
	}

	/** True when the id has already been seen, whether defined or just mentioned. */
	has(id: string): boolean {
		return this.nodes.has(id);
	}

	finish(): Diagram {
		this.closeStep();
		this.applyGroupAssignments();
		return this.assemble();
	}

	private applyGroupAssignments(): void {
		for (const { node, group } of this.groupAssignments) {
			const target = this.nodes.get(node);
			const home = this.groups.get(group);
			if (!target) {
				this.warn(`@zone ${group} names unknown node "${node}"`);
				continue;
			}
			if (!home) continue;
			// A @zone inside a plate keeps its plate. Hook the zone under it if it has no parent.
			if (!home.parent && target.group && root(target.group) !== home) {
				home.parent = target.group;
			}
			target.group = home;
		}
	}

	private assemble(): Diagram {
		const pending = [...this.nodes.values()];
		const tops = [...this.groups.values()].filter((group) => !group.parent);
		const nodes: DiagramNode[] = [];
		const layers: DiagramLayer[] = [];
		const zones: DiagramZone[] = [];

		const resolveKind = (node: PendingNode): NodeKind =>
			this.kindOverrides.get(node.id) ??
			node.kind ??
			inferKind(node.id, node.label, node.shapeKind ?? 'service');

		const usesPlates = tops.length > 0 && !this.flatGroups;

		if (usesPlates) {
			for (const group of tops) {
				layers.push({ id: group.id, title: group.title });
			}
			for (const group of this.groups.values()) {
				if (group.parent) {
					zones.push({
						id: group.id,
						title: group.title,
						layer: root(group).id,
						parent: group.parent.parent ? group.parent.id : null
					});
				}
			}
		} else {
			const single = { id: 'main', title: this.title || 'Diagram' };
			layers.push(single);
			for (const group of this.groups.values()) {
				zones.push({
					id: group.id,
					title: group.title,
					layer: single.id,
					parent: group.parent ? group.parent.id : null
				});
			}
		}

		for (const node of pending) {
			const kind = resolveKind(node);
			const detail = this.detailOverrides.get(node.id) ?? node.detail;
			let layer = layers[0].id;
			let zone: string | null = null;
			if (node.group) {
				if (usesPlates) {
					layer = root(node.group).id;
					zone = node.group.parent ? node.group.id : null;
				} else {
					zone = node.group.id;
				}
			} else if (usesPlates) {
				layer = '__outside';
			}
			nodes.push({ id: node.id, label: node.label, detail, kind, layer, zone });
		}

		if (nodes.some((node) => node.layer === '__outside')) {
			layers.push({ id: '__outside', title: 'Outside' });
		}

		const diagram: Diagram = {
			title: this.title || 'Untitled diagram',
			format: this.format,
			layers,
			zones,
			nodes,
			edges: this.edges,
			steps: this.steps,
			warnings: this.warnings
		};

		if (tops.length === 0 && this.autoLayer) applyAutoLayers(diagram);
		dropEmptyLayers(diagram);
		titleSteps(diagram);
		return diagram;
	}
}

function root(group: Group): Group {
	let top = group;
	while (top.parent) top = top.parent;
	return top;
}

/** Sorts a flat diagram into UI, application and infrastructure plates by node kind. */
function applyAutoLayers(diagram: Diagram): void {
	const present = new Set(diagram.nodes.map((node) => tierForKind(node.kind)));
	if (present.size < 2) return;
	diagram.layers = TIERS.filter((tier) => present.has(tier.id)).map((tier) => ({
		id: tier.id,
		title: tier.title
	}));
	for (const node of diagram.nodes) node.layer = tierForKind(node.kind);
	diagram.warnings.push({
		line: null,
		message:
			'The source has no layers, so nodes were sorted by inferred type. Add groups to set them yourself, or write "@autolayer off" in a comment.'
	});
}

function dropEmptyLayers(diagram: Diagram): void {
	const used = new Set(diagram.nodes.map((node) => node.layer));
	const kept = diagram.layers.filter((layer) => used.has(layer.id));
	diagram.layers = kept.length > 0 ? kept : diagram.layers.slice(0, 1);
	const occupied = new Set(diagram.nodes.map((node) => node.zone));
	let changed = true;
	const keep = new Set<string>();
	for (const zone of diagram.zones) if (occupied.has(zone.id)) keep.add(zone.id);
	while (changed) {
		changed = false;
		for (const zone of diagram.zones) {
			if (keep.has(zone.id) && zone.parent && !keep.has(zone.parent)) {
				keep.add(zone.parent);
				changed = true;
			}
		}
	}
	diagram.zones = diagram.zones.filter((zone) => keep.has(zone.id));
}

function titleSteps(diagram: Diagram): void {
	const edges = new Map(diagram.edges.map((edge) => [edge.id, edge]));
	const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
	for (const step of diagram.steps) {
		const first = edges.get(step.edges[0]);
		if (!first) continue;
		const from = nodes.get(first.from)?.label ?? first.from;
		const to = nodes.get(first.to)?.label ?? first.to;
		const labelled = step.edges
			.map((id) => edges.get(id)?.label)
			.filter((label): label is string => Boolean(label));
		step.title = labelled[0] ?? `${from} to ${to}`;
		if (labelled.length > 1) step.title = `${labelled[0]} and ${labelled.length - 1} more`;
		if (!step.title && step.caption) step.title = step.caption;
	}
}
