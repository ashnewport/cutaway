/** Every type here is plain data, so the core runs unchanged in Node and in the browser. */

export type NodeKind =
	| 'actor'
	| 'screen'
	| 'service'
	| 'function'
	| 'database'
	| 'storage'
	| 'cache'
	| 'queue'
	| 'gateway'
	| 'loadbalancer'
	| 'internet'
	| 'cdn'
	| 'dns'
	| 'firewall'
	| 'auth'
	| 'secret'
	| 'decision'
	| 'state'
	| 'class'
	| 'terminal';

export type SourceFormat =
	| 'mermaid-flowchart'
	| 'mermaid-sequence'
	| 'mermaid-state'
	| 'mermaid-class'
	| 'plantuml'
	| 'dot'
	| 'json';

export type EdgeStyle = 'solid' | 'dashed' | 'thick';

/** What a packet looks like in flight. Inferred from the message label. */
export type PayloadKind = 'data' | 'credential' | 'error';

export interface DiagramNode {
	id: string;
	label: string;
	detail: string;
	kind: NodeKind;
	layer: string;
	zone: string | null;
}

export interface DiagramLayer {
	id: string;
	title: string;
}

/** A nested region on a plate, such as a VPC or a subnet. */
export interface DiagramZone {
	id: string;
	title: string;
	layer: string;
	parent: string | null;
}

export interface DiagramEdge {
	id: string;
	from: string;
	to: string;
	label: string;
	style: EdgeStyle;
	payload: PayloadKind;
	directed: boolean;
}

export interface DiagramStep {
	id: string;
	title: string;
	caption: string;
	edges: string[];
}

export interface Warning {
	line: number | null;
	message: string;
}

export interface Diagram {
	title: string;
	format: SourceFormat;
	layers: DiagramLayer[];
	zones: DiagramZone[];
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	steps: DiagramStep[];
	warnings: Warning[];
}

export type Vec3 = [number, number, number];

export interface Rect {
	x: number;
	z: number;
	width: number;
	depth: number;
}

export interface PlacedNode extends DiagramNode {
	position: Vec3;
	height: number;
	layerIndex: number;
}

export interface PlacedZone extends DiagramZone {
	rect: Rect;
	depth: number;
	layerIndex: number;
}

export interface PlacedLayer extends DiagramLayer {
	index: number;
	y: number;
	rect: Rect;
}

/** One physical track. Every message between the same ordered pair of nodes shares a route. */
export interface Route {
	id: string;
	from: string;
	to: string;
	kind: 'plate' | 'cross' | 'self';
	points: Vec3[];
	length: number;
	style: EdgeStyle;
	directed: boolean;
	layers: number[];
	/** Where a cross-layer route passes through a plate, for drawing the portal rings. */
	crossings: { layerIndex: number; position: Vec3 }[];
}

export interface Scene {
	diagram: Diagram;
	layers: PlacedLayer[];
	zones: PlacedZone[];
	nodes: PlacedNode[];
	routes: Route[];
	edgeRoute: Record<string, string>;
	bounds: { center: Vec3; radius: number };
	plateThickness: number;
}

export interface CameraShot {
	target: Vec3;
	radius: number;
	azimuth: number;
	elevation: number;
}

export type CueType = 'swell' | 'depart' | 'arrive' | 'plunge' | 'rise' | 'error';

export interface AudioCue {
	time: number;
	type: CueType;
	/** Semitones from A3. Upper layers sit in a higher register than lower ones. */
	pitch: number;
	gain: number;
}

export interface ScriptPacket {
	edge: string;
	route: string;
	label: string;
	payload: PayloadKind;
	start: number;
	travel: number;
}

export interface ScriptStep {
	index: number;
	id: string;
	title: string;
	caption: string;
	path: string;
	start: number;
	end: number;
	packets: ScriptPacket[];
	nodes: string[];
	layers: number[];
	focus: number[];
	shot: CameraShot;
	shotDuration: number;
}

export interface Script {
	duration: number;
	introDuration: number;
	outroStart: number;
	overview: CameraShot;
	steps: ScriptStep[];
	cues: AudioCue[];
}
