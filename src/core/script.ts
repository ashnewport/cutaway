import { hashText } from './hash.ts';
import type {
	AudioCue,
	CameraShot,
	CueType,
	Route,
	Scene,
	Script,
	ScriptPacket,
	ScriptStep,
	Vec3
} from './types.ts';

const DEG = Math.PI / 180;
const INTRO = 2.2;
const OUTRO = 2.4;
const HOLD = 0.4;
const STAGGER = 0.22;
const PENTATONIC = [0, 3, 5, 7, 10];

export interface ScriptOptions {
	/** Multiplied into every packet's travel time. */
	pace?: number;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function overviewShot(scene: Scene): CameraShot {
	return {
		target: scene.bounds.center,
		radius: scene.bounds.radius,
		azimuth: 38 * DEG,
		elevation: 20 * DEG
	};
}

/** Pure timing and camera plan. The browser turns this into GSAP tweens and Web Audio notes. */
export function buildScript(
	scene: Scene,
	hiddenLayers: number[] = [],
	options: ScriptOptions = {}
): Script {
	const pace = options.pace ?? 1;
	const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
	const routes = new Map(scene.routes.map((route) => [route.id, route]));
	const edges = new Map(scene.diagram.edges.map((edge) => [edge.id, edge]));
	const hidden = new Set(hiddenLayers);
	const overview = overviewShot(scene);
	const steps: ScriptStep[] = [];
	const cues: AudioCue[] = [{ time: 0.1, type: 'swell', pitch: -12, gain: 0.6 }];

	const playable = scene.diagram.steps
		.map((step) => ({
			step,
			edges: step.edges.filter((id) => {
				const edge = edges.get(id);
				if (!edge) return false;
				const from = nodes.get(edge.from);
				const to = nodes.get(edge.to);
				return from && to && !hidden.has(from.layerIndex) && !hidden.has(to.layerIndex);
			})
		}))
		.filter((entry) => entry.edges.length > 0);

	let clock = INTRO;
	let previousLayers = '';

	playable.forEach((entry, index) => {
		const packetEdges = entry.edges.map((id) => edges.get(id)!);
		const touched = new Set<string>();
		for (const edge of packetEdges) {
			touched.add(edge.from);
			touched.add(edge.to);
		}
		const touchedNodes = [...touched].map((id) => nodes.get(id)!);
		const layerSet = [...new Set(touchedNodes.map((node) => node.layerIndex))].sort(
			(a, b) => a - b
		);
		const layerKey = layerSet.join(',');
		const shot = frameStep(scene, touchedNodes, layerSet, index);
		const moved = layerKey !== previousLayers;
		const shotDuration = moved ? 1.15 : 0.8;
		const lead = moved ? 0.75 : 0.18;

		let latest = clock + lead;
		const packets: ScriptPacket[] = packetEdges.map((edge, offset) => {
			const route = routes.get(scene.edgeRoute[edge.id])!;
			const base = route.kind === 'cross' ? route.length / 7.5 : route.length / 6.5;
			const travel = clamp(base, 0.8, 2.2) * pace;
			const start = clock + lead + offset * STAGGER;
			latest = Math.max(latest, start + travel);
			const pitch = pitchFor(edge.id + edge.label, nodes.get(edge.to)!.layerIndex);
			const departType = departCue(
				route.kind,
				nodes.get(edge.from)!.position,
				nodes.get(edge.to)!.position
			);
			cues.push({ time: start, type: departType, pitch, gain: 0.5 });
			cues.push({
				time: start + travel,
				type: edge.payload === 'error' ? 'error' : 'arrive',
				pitch,
				gain: 0.85
			});
			return {
				edge: edge.id,
				route: route.id,
				label: edge.label,
				payload: edge.payload,
				start,
				travel
			};
		});

		const end = latest + HOLD;
		const focus = scene.layers.map((layer) => (layerSet.includes(layer.index) ? 1 : 0));
		steps.push({
			index,
			id: entry.step.id,
			title: entry.step.title,
			caption: entry.step.caption,
			path: describePath(
				packetEdges.map((edge) => [edge.from, edge.to]),
				nodes
			),
			start: clock,
			end,
			packets,
			nodes: [...touched],
			layers: layerSet,
			focus,
			shot,
			shotDuration
		});
		clock = end;
		previousLayers = layerKey;
	});

	return {
		duration: clock + OUTRO,
		introDuration: INTRO,
		outroStart: clock,
		overview,
		steps,
		cues: cues.sort((a, b) => a.time - b.time)
	};
}

function describePath(pairs: string[][], nodes: Map<string, { label: string }>): string {
	const [from, to] = pairs[0];
	const base = `${nodes.get(from)?.label ?? from} to ${nodes.get(to)?.label ?? to}`;
	return pairs.length > 1 ? `${base}, plus ${pairs.length - 1} more` : base;
}

function departCue(kind: Route['kind'], from: Vec3, to: Vec3): CueType {
	if (kind !== 'cross') return 'depart';
	return to[1] < from[1] ? 'plunge' : 'rise';
}

function pitchFor(seed: string, layerIndex: number): number {
	const scale = PENTATONIC[hashText(seed) % PENTATONIC.length];
	return 12 - layerIndex * 7 + scale;
}

function frameStep(
	scene: Scene,
	touched: Scene['nodes'],
	layerSet: number[],
	index: number
): CameraShot {
	const drift = Math.sin(index * 0.9) * 7 * DEG;
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (const node of touched) {
		minX = Math.min(minX, node.position[0]);
		maxX = Math.max(maxX, node.position[0]);
		minY = Math.min(minY, node.position[1]);
		maxY = Math.max(maxY, node.position[1] + node.height);
		minZ = Math.min(minZ, node.position[2]);
		maxZ = Math.max(maxZ, node.position[2]);
	}
	const mid: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];

	if (layerSet.length === 1) {
		const layer = scene.layers[layerSet[0]];
		const plateRadius = Math.hypot(layer.rect.width, layer.rect.depth) / 2;
		const spread = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 3.4;
		return {
			// Lean hard toward the action, so labels stay readable even on a crowded plate.
			target: [lerp(0, mid[0], 0.82), layer.y + 0.6, lerp(0, mid[2], 0.82)],
			radius: clamp(spread * 1.3, 10, plateRadius * 0.9),
			azimuth: 38 * DEG + drift,
			elevation: 38 * DEG
		};
	}

	const halfHeight = (maxY - minY) / 2 + 1.4;
	const halfSpread = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 2;
	return {
		target: mid,
		radius: Math.max(halfHeight * 1.25, halfSpread * 1.1, 9),
		azimuth: 52 * DEG + drift,
		// A low angle makes the fall between plates easy to read.
		elevation: 16 * DEG
	};
}
