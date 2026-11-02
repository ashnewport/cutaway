import { inferKind, inferPayload } from '../kinds.ts';
import { cleanLabel } from './builder.ts';
import { ParseError } from './shared.ts';
import type {
	Diagram,
	DiagramEdge,
	DiagramNode,
	DiagramStep,
	EdgeStyle,
	NodeKind
} from '../types.ts';

interface JsonNode {
	id: string;
	label?: string;
	detail?: string;
	kind?: NodeKind;
	zone?: string;
}

interface JsonEdge {
	from: string;
	to: string;
	label?: string;
	style?: EdgeStyle;
	failed?: boolean;
}

interface JsonDocument {
	title?: string;
	layers?: {
		id?: string;
		title?: string;
		zones?: { id: string; title?: string; parent?: string }[];
		nodes?: JsonNode[];
	}[];
	steps?: { caption?: string; edges?: JsonEdge[] }[];
}

export function parseJson(source: string): Diagram {
	let doc: JsonDocument;
	try {
		doc = JSON.parse(source) as JsonDocument;
	} catch (error) {
		throw new ParseError(`The JSON does not parse: ${(error as Error).message}`);
	}
	if (!Array.isArray(doc.layers) || doc.layers.length === 0) {
		throw new ParseError('A Cutaway JSON document needs a non-empty "layers" array');
	}

	const diagram: Diagram = {
		title: doc.title ?? 'Untitled diagram',
		format: 'json',
		layers: [],
		zones: [],
		nodes: [],
		edges: [],
		steps: [],
		warnings: []
	};
	const nodes = new Map<string, DiagramNode>();

	doc.layers.forEach((layer, index) => {
		const id = layer.id ?? `layer${index + 1}`;
		diagram.layers.push({ id, title: layer.title ?? id });
		for (const zone of layer.zones ?? []) {
			diagram.zones.push({
				id: zone.id,
				title: zone.title ?? zone.id,
				layer: id,
				parent: zone.parent ?? null
			});
		}
		for (const node of layer.nodes ?? []) {
			if (!node.id) throw new ParseError(`A node in layer "${id}" has no "id"`);
			const label = node.label ?? node.id;
			const placed: DiagramNode = {
				id: node.id,
				label,
				detail: node.detail ?? '',
				kind: node.kind ?? inferKind(node.id, label),
				layer: id,
				zone: node.zone ?? null
			};
			nodes.set(node.id, placed);
			diagram.nodes.push(placed);
		}
	});

	(doc.steps ?? []).forEach((step, stepIndex) => {
		const ids: string[] = [];
		for (const edge of step.edges ?? []) {
			if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
				throw new ParseError(
					`Step ${stepIndex + 1} links "${edge.from}" to "${edge.to}", but one of them is not a node`
				);
			}
			const label = cleanLabel(edge.label ?? '').label;
			const built: DiagramEdge = {
				id: `e${diagram.edges.length + 1}`,
				from: edge.from,
				to: edge.to,
				label,
				style: edge.style ?? 'solid',
				payload: inferPayload(label, edge.failed ?? false),
				directed: true
			};
			diagram.edges.push(built);
			ids.push(built.id);
		}
		if (ids.length === 0) return;
		const first = diagram.edges.find((edge) => edge.id === ids[0]);
		const titled: DiagramStep = {
			id: `s${diagram.steps.length + 1}`,
			title:
				first?.label ||
				`${nodes.get(first?.from ?? '')?.label} to ${nodes.get(first?.to ?? '')?.label}`,
			caption: step.caption ?? '',
			edges: ids
		};
		diagram.steps.push(titled);
	});

	return diagram;
}
