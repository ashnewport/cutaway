import dagre from '@dagrejs/dagre';
import type {
	Diagram,
	DiagramNode,
	PlacedLayer,
	PlacedNode,
	PlacedZone,
	Rect,
	Route,
	Scene,
	Vec3
} from './types.ts';

export interface LayoutOptions {
	/** Multiplies the automatic distance between plates. */
	gapScale: number;
}

const WORLD = 1 / 48;
const NODE_WIDTH = 128;
const NODE_DEPTH = 108;
const PLATE_MARGIN = 2.2;
const ZONE_PAD = 0.8;
const ZONE_TITLE_PAD = 0.75;
const PLATE_THICKNESS = 0.22;
const PLATE_TITLE_SPACE = 1.5;
const MIN_PLATE_WIDTH = 15;
const MIN_PLATE_DEPTH = 9;
const NODE_HEIGHT = 1.7;
const MAX_SPREAD = 2.1;
const OVERVIEW_ELEVATION = (20 * Math.PI) / 180;
const ZONE_STEP = 0.07;

interface FlatLayout {
	positions: Map<string, { x: number; z: number }>;
	zoneRects: Map<string, Rect>;
	paths: Map<string, { x: number; z: number }[]>;
	bounds: Rect;
	/** Scales node positions and routes, leaving node size and zone padding alone. */
	spread: (factor: number) => void;
}

export function layoutScene(diagram: Diagram, options: Partial<LayoutOptions> = {}): Scene {
	const flats = diagram.layers.map((layer) => layoutLayer(diagram, layer.id));

	const width = Math.max(
		MIN_PLATE_WIDTH,
		...flats.map((flat) => flat.bounds.width + PLATE_MARGIN * 2)
	);
	const depth = Math.max(
		MIN_PLATE_DEPTH,
		...flats.map((flat) => flat.bounds.depth + PLATE_MARGIN * 2 + PLATE_TITLE_SPACE)
	);

	// Every plate is the same size, so a sparse layer spreads out rather than huddling in the middle.
	for (const flat of flats) {
		const roomX = (width - PLATE_MARGIN * 2) / Math.max(flat.bounds.width, 1);
		const roomZ = (depth - PLATE_MARGIN * 2 - PLATE_TITLE_SPACE) / Math.max(flat.bounds.depth, 1);
		flat.spread(Math.min(MAX_SPREAD, Math.max(1, Math.min(roomX, roomZ))));
	}

	// Far enough apart that plates do not overlap on screen at the overview camera angle.
	const layerGap =
		Math.max(6, Math.min(16, depth * Math.sin(OVERVIEW_ELEVATION) * 1.05)) *
		(options.gapScale ?? 1);

	const layers: PlacedLayer[] = diagram.layers.map((layer, index) => ({
		...layer,
		index,
		y: -index * layerGap,
		rect: { x: -width / 2, z: -depth / 2, width, depth }
	}));
	const layerIndex = new Map(layers.map((layer) => [layer.id, layer.index]));

	const zones: PlacedZone[] = [];
	const nodes: PlacedNode[] = [];
	const positions = new Map<string, PlacedNode>();
	const flatCentres = flats.map((flat) => ({
		x: flat.bounds.x + flat.bounds.width / 2,
		// Bias toward the back of the plate so the printed title has clear space at the front.
		z: flat.bounds.z + flat.bounds.depth / 2 + PLATE_TITLE_SPACE / 2
	}));

	const zoneDepth = (id: string | null): number => {
		let total = 0;
		for (let zone = diagram.zones.find((candidate) => candidate.id === id); zone; ) {
			total++;
			const parent = zone.parent;
			zone = diagram.zones.find((candidate) => candidate.id === parent);
		}
		return total;
	};

	for (const zone of diagram.zones) {
		const index = layerIndex.get(zone.layer);
		if (index === undefined) continue;
		const rect = flats[index].zoneRects.get(zone.id);
		if (!rect) continue;
		const centre = flatCentres[index];
		zones.push({
			...zone,
			layerIndex: index,
			depth: zoneDepth(zone.id),
			rect: { ...rect, x: rect.x - centre.x, z: rect.z - centre.z }
		});
	}

	for (const node of diagram.nodes) {
		const index = layerIndex.get(node.layer);
		if (index === undefined) continue;
		const flat = flats[index];
		const centre = flatCentres[index];
		const spot = flat.positions.get(node.id) ?? { x: centre.x, z: centre.z };
		const lift = zoneDepth(node.zone) * ZONE_STEP;
		const placed: PlacedNode = {
			...node,
			layerIndex: index,
			height: NODE_HEIGHT,
			position: [spot.x - centre.x, layers[index].y + PLATE_THICKNESS / 2 + lift, spot.z - centre.z]
		};
		nodes.push(placed);
		positions.set(node.id, placed);
	}

	const routes = buildRoutes(diagram, flats, flatCentres, positions, layers);
	const edgeRoute: Record<string, string> = {};
	for (const edge of diagram.edges) edgeRoute[edge.id] = routeId(edge.from, edge.to);

	const stackHeight = (layers.length - 1) * layerGap;
	return {
		diagram,
		layers,
		zones,
		nodes,
		routes,
		edgeRoute,
		bounds: {
			center: [0, -stackHeight / 2, 0],
			radius: Math.hypot(width / 2, depth / 2, stackHeight / 2 + 1)
		},
		plateThickness: PLATE_THICKNESS
	};
}

export function routeId(from: string, to: string): string {
	return `${from}=>${to}`;
}

function layoutLayer(diagram: Diagram, layerId: string): FlatLayout {
	const graph = new dagre.graphlib.Graph({ compound: true, multigraph: false });
	graph.setGraph({ rankdir: 'LR', nodesep: 54, ranksep: 76, edgesep: 34, marginx: 0, marginy: 0 });
	graph.setDefaultEdgeLabel(() => ({}));

	const members = diagram.nodes.filter((node) => node.layer === layerId);
	const memberIds = new Set(members.map((node) => node.id));
	const layerZones = diagram.zones.filter((zone) => zone.layer === layerId);

	for (const zone of layerZones) graph.setNode(zone.id, {});
	for (const zone of layerZones) if (zone.parent) graph.setParent(zone.id, zone.parent);
	for (const node of members) {
		graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_DEPTH });
		if (node.zone) graph.setParent(node.id, node.zone);
	}

	const connected = new Set<string>();
	const seen = new Set<string>();
	const pairKey = new Map<string, { from: string; to: string }>();
	for (const edge of diagram.edges) {
		if (edge.from === edge.to) continue;
		if (!memberIds.has(edge.from) || !memberIds.has(edge.to)) continue;
		connected.add(edge.from);
		connected.add(edge.to);
		const key = routeId(edge.from, edge.to);
		if (seen.has(key)) continue;
		seen.add(key);
		pairKey.set(key, { from: edge.from, to: edge.to });
		graph.setEdge(edge.from, edge.to, {});
	}

	// Nodes with no links on this plate would stack into one tall column. Spread them into a grid.
	spreadIsolated(graph, members, connected);

	dagre.layout(graph);

	const positions = new Map<string, { x: number; z: number }>();
	for (const node of members) {
		const placed = graph.node(node.id);
		positions.set(node.id, { x: placed.x * WORLD, z: placed.y * WORLD });
	}

	const zoneRects = new Map<string, Rect>();
	const halfW = (NODE_WIDTH * WORLD) / 2;
	const halfD = (NODE_DEPTH * WORLD) / 2;

	const rectOf = (zoneId: string): Rect | null => {
		const cached = zoneRects.get(zoneId);
		if (cached) return cached;
		let minX = Infinity;
		let minZ = Infinity;
		let maxX = -Infinity;
		let maxZ = -Infinity;
		for (const node of members.filter((candidate) => candidate.zone === zoneId)) {
			const spot = positions.get(node.id);
			if (!spot) continue;
			minX = Math.min(minX, spot.x - halfW);
			maxX = Math.max(maxX, spot.x + halfW);
			minZ = Math.min(minZ, spot.z - halfD);
			maxZ = Math.max(maxZ, spot.z + halfD);
		}
		for (const child of layerZones.filter((candidate) => candidate.parent === zoneId)) {
			const rect = rectOf(child.id);
			if (!rect) continue;
			minX = Math.min(minX, rect.x);
			maxX = Math.max(maxX, rect.x + rect.width);
			minZ = Math.min(minZ, rect.z);
			maxZ = Math.max(maxZ, rect.z + rect.depth);
		}
		if (minX === Infinity) return null;
		const rect = {
			x: minX - ZONE_PAD,
			z: minZ - ZONE_PAD - ZONE_TITLE_PAD,
			width: maxX - minX + ZONE_PAD * 2,
			depth: maxZ - minZ + ZONE_PAD * 2 + ZONE_TITLE_PAD
		};
		zoneRects.set(zoneId, rect);
		return rect;
	};

	const paths = new Map<string, { x: number; z: number }[]>();
	for (const [key, pair] of pairKey) {
		const edge = graph.edge(pair.from, pair.to);
		const points = (edge?.points ?? []) as { x: number; y: number }[];
		paths.set(
			key,
			points.map((point) => ({ x: point.x * WORLD, z: point.y * WORLD }))
		);
	}

	const measure = (): Rect => {
		zoneRects.clear();
		for (const zone of layerZones) rectOf(zone.id);
		let minX = Infinity;
		let minZ = Infinity;
		let maxX = -Infinity;
		let maxZ = -Infinity;
		for (const spot of positions.values()) {
			minX = Math.min(minX, spot.x - halfW);
			maxX = Math.max(maxX, spot.x + halfW);
			minZ = Math.min(minZ, spot.z - halfD);
			maxZ = Math.max(maxZ, spot.z + halfD);
		}
		for (const rect of zoneRects.values()) {
			minX = Math.min(minX, rect.x);
			maxX = Math.max(maxX, rect.x + rect.width);
			minZ = Math.min(minZ, rect.z);
			maxZ = Math.max(maxZ, rect.z + rect.depth);
		}
		if (minX === Infinity) minX = minZ = maxX = maxZ = 0;
		return { x: minX, z: minZ, width: maxX - minX, depth: maxZ - minZ };
	};

	const flat: FlatLayout = {
		positions,
		zoneRects,
		paths,
		bounds: measure(),
		spread(factor) {
			if (factor <= 1.001) return;
			for (const spot of positions.values()) {
				spot.x *= factor;
				spot.z *= factor;
			}
			for (const path of paths.values()) {
				for (const point of path) {
					point.x *= factor;
					point.z *= factor;
				}
			}
			flat.bounds = measure();
		}
	};
	return flat;
}

function spreadIsolated(
	graph: InstanceType<typeof dagre.graphlib.Graph>,
	members: DiagramNode[],
	connected: Set<string>
): void {
	const byZone = new Map<string, DiagramNode[]>();
	for (const node of members) {
		if (connected.has(node.id)) continue;
		const key = node.zone ?? '';
		byZone.set(key, [...(byZone.get(key) ?? []), node]);
	}
	const groups = [...byZone.values()];
	for (const group of groups) {
		const perRow = Math.max(2, Math.ceil(Math.sqrt(group.length * 1.6)));
		for (let index = 0; index + 1 < group.length; index++) {
			if ((index + 1) % perRow === 0) continue;
			graph.setEdge(group[index].id, group[index + 1].id, { minlen: 1, weight: 0 });
		}
	}
	// Separate groups with no links would also stack, so lay them out left to right too.
	for (let index = 0; index + 1 < groups.length; index++) {
		const current = groups[index];
		graph.setEdge(current[current.length - 1].id, groups[index + 1][0].id, {
			minlen: 1,
			weight: 0
		});
	}
}

function buildRoutes(
	diagram: Diagram,
	flats: FlatLayout[],
	centres: { x: number; z: number }[],
	positions: Map<string, PlacedNode>,
	layers: PlacedLayer[]
): Route[] {
	const routes = new Map<string, Route>();
	const pairs = new Set(diagram.edges.map((edge) => routeId(edge.from, edge.to)));

	for (const edge of diagram.edges) {
		const from = positions.get(edge.from);
		const to = positions.get(edge.to);
		if (!from || !to) continue;
		const id = routeId(edge.from, edge.to);
		const existing = routes.get(id);
		if (existing) {
			if (edge.style === 'thick') existing.style = 'thick';
			else if (edge.style === 'solid' && existing.style === 'dashed') existing.style = 'solid';
			existing.directed ||= edge.directed;
			continue;
		}
		const hasReverse = pairs.has(routeId(edge.to, edge.from));
		let points: Vec3[];
		let kind: Route['kind'];
		let crossings: Route['crossings'] = [];
		if (edge.from === edge.to) {
			kind = 'self';
			points = selfLoop(from);
		} else if (from.layerIndex === to.layerIndex) {
			kind = 'plate';
			const path = flats[from.layerIndex].paths.get(id) ?? [];
			const centre = centres[from.layerIndex];
			points = plateRoute(from, to, path, centre, hasReverse);
		} else {
			kind = 'cross';
			points = crossRoute(from, to, hasReverse);
			crossings = findCrossings(points, layers);
		}
		routes.set(id, {
			id,
			from: edge.from,
			to: edge.to,
			kind,
			points,
			length: polylineLength(points),
			style: edge.style,
			directed: edge.directed,
			layers: [...new Set([from.layerIndex, to.layerIndex])],
			crossings
		});
	}
	return [...routes.values()];
}

function polylineLength(points: Vec3[]): number {
	let total = 0;
	for (let index = 1; index < points.length; index++) {
		const a = points[index - 1];
		const b = points[index];
		total += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
	}
	return total;
}

function selfLoop(node: PlacedNode): Vec3[] {
	const [x, y, z] = node.position;
	const top = y + node.height;
	const out: Vec3[] = [];
	const radius = 0.62;
	const count = 18;
	for (let index = 0; index <= count; index++) {
		const angle = (index / count) * Math.PI * 2;
		out.push([
			x + radius + Math.cos(angle + Math.PI) * radius,
			top * 0.5 + (y + node.height * 0.5) * 0.5 + Math.sin(angle) * radius * 0.9 + 0.5,
			z
		]);
	}
	return out;
}

/** Lifts a flat dagre path into a low arc above the plate. */
function plateRoute(
	from: PlacedNode,
	to: PlacedNode,
	path: { x: number; z: number }[],
	centre: { x: number; z: number },
	hasReverse: boolean
): Vec3[] {
	const local =
		path.length >= 2
			? path.map((point) => ({ x: point.x - centre.x, z: point.z - centre.z }))
			: [
					{ x: from.position[0], z: from.position[2] },
					{ x: to.position[0], z: to.position[2] }
				];

	// A two-way link gets two side-by-side tracks. The offset is relative to travel direction,
	// so each direction always sits on its own right-hand side.
	const dx = to.position[0] - from.position[0];
	const dz = to.position[2] - from.position[2];
	const span = Math.hypot(dx, dz) || 1;
	const side = hasReverse ? 0.2 : 0;
	const offsetX = (-dz / span) * side;
	const offsetZ = (dx / span) * side;

	local[0] = { x: from.position[0], z: from.position[2] };
	local[local.length - 1] = { x: to.position[0], z: to.position[2] };

	const startY = from.position[1] + 0.32;
	const endY = to.position[1] + 0.32;
	const arc = Math.min(1.3, 0.45 + span * 0.05) + (hasReverse ? 0.12 : 0);
	const dense = resample(local, 14);
	return dense.map((point, index) => {
		const t = index / (dense.length - 1);
		const lift = Math.sin(t * Math.PI) * arc;
		const taper = Math.sin(t * Math.PI);
		return [
			point.x + offsetX * taper,
			startY + (endY - startY) * t + lift,
			point.z + offsetZ * taper
		];
	});
}

function resample(points: { x: number; z: number }[], count: number): { x: number; z: number }[] {
	const lengths = [0];
	for (let index = 1; index < points.length; index++) {
		lengths.push(
			lengths[index - 1] +
				Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z)
		);
	}
	const total = lengths[lengths.length - 1] || 1;
	const out: { x: number; z: number }[] = [];
	let segment = 1;
	for (let index = 0; index < count; index++) {
		const target = (index / (count - 1)) * total;
		while (segment < points.length - 1 && lengths[segment] < target) segment++;
		const span = lengths[segment] - lengths[segment - 1] || 1;
		const t = (target - lengths[segment - 1]) / span;
		out.push({
			x: points[segment - 1].x + (points[segment].x - points[segment - 1].x) * t,
			z: points[segment - 1].z + (points[segment].z - points[segment - 1].z) * t
		});
	}
	return out;
}

/** A vertical S-curve between plates, sampled from a cubic Bezier. */
function crossRoute(from: PlacedNode, to: PlacedNode, hasReverse: boolean): Vec3[] {
	const descending = to.position[1] < from.position[1];
	const side = hasReverse ? 0.2 * (descending ? 1 : -1) : 0;
	const start: Vec3 = [
		from.position[0] + side,
		from.position[1] + (descending ? 0.1 : 0.9),
		from.position[2] + side
	];
	const end: Vec3 = [
		to.position[0] + side,
		to.position[1] + (descending ? to.height + 0.05 : 0.05),
		to.position[2] + side
	];
	const pull = Math.abs(end[1] - start[1]) * 0.55;
	const direction = descending ? -1 : 1;
	const c1: Vec3 = [start[0], start[1] + direction * pull, start[2]];
	const c2: Vec3 = [end[0], end[1] - direction * pull, end[2]];
	const out: Vec3[] = [];
	const count = 28;
	for (let index = 0; index <= count; index++) {
		const t = index / count;
		const u = 1 - t;
		out.push([
			u * u * u * start[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
			u * u * u * start[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
			u * u * u * start[2] + 3 * u * u * t * c1[2] + 3 * u * t * t * c2[2] + t * t * t * end[2]
		]);
	}
	return out;
}

function findCrossings(points: Vec3[], layers: PlacedLayer[]): Route['crossings'] {
	const out: Route['crossings'] = [];
	for (const layer of layers) {
		for (let index = 1; index < points.length; index++) {
			const a = points[index - 1];
			const b = points[index];
			if ((a[1] - layer.y) * (b[1] - layer.y) <= 0 && a[1] !== b[1]) {
				const t = (layer.y - a[1]) / (b[1] - a[1]);
				out.push({
					layerIndex: layer.index,
					position: [a[0] + (b[0] - a[0]) * t, layer.y, a[2] + (b[2] - a[2]) * t]
				});
				break;
			}
		}
	}
	return out;
}
