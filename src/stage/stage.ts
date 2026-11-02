import gsap from 'gsap';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
	layerColor,
	type AudioCue,
	type PayloadKind,
	type PlacedLayer,
	type PlacedNode,
	type PlacedZone,
	type Route,
	type Scene,
	type Script,
	type Theme
} from '../core/index.ts';
import { Director, type CameraState } from './director.ts';
import {
	makeBackdrop,
	makeContactShadow,
	makeDashes,
	makeHalo,
	makeLabel,
	makePlateTexture,
	makePrintedText,
	mix,
	readableOn
} from './paint.ts';
import { buildNodeShape, makeNodeMaterials, SHAPE_SCALE, shapeHeight } from './shapes.ts';

export interface ViewOptions {
	labels: boolean;
	packetLabels: boolean;
	idleRoutes: boolean;
	ghost: boolean;
	isometric: boolean;
	shadows: boolean;
	bloom: boolean;
	drift: boolean;
}

export const DEFAULT_VIEW: ViewOptions = {
	labels: true,
	packetLabels: true,
	idleRoutes: true,
	ghost: true,
	isometric: false,
	shadows: true,
	bloom: true,
	drift: true
};

interface Insets {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

interface FadeEntry {
	material: THREE.Material;
	base: number;
}

interface LayerPart {
	group: THREE.Group;
	fades: FadeEntry[];
	labels: THREE.SpriteMaterial[];
	labelSprites: THREE.Sprite[];
	/** Opaque when focused. They must stop writing depth once faded, or they hide what is beneath. */
	depthWriters: THREE.Material[];
	/** The plate's own surfaces. They thin out further whenever something beneath is in focus. */
	surfaces: FadeEntry[];
	surfaceWriters: THREE.Material[];
	factor: number;
	shadowMaterial: THREE.MeshBasicMaterial | null;
}

interface NodePart {
	root: THREE.Group;
	shape: THREE.Group;
	emissive: THREE.MeshStandardMaterial[];
	ring: THREE.Mesh;
	ringMaterial: THREE.MeshBasicMaterial;
	layer: number;
	heat: number;
	ringValue: number;
}

interface RoutePart {
	route: Route;
	curve: THREE.CatmullRomCurve3;
	mesh: THREE.Mesh;
	material: THREE.MeshBasicMaterial;
	arrow: THREE.Mesh | null;
	arrowMaterial: THREE.MeshBasicMaterial | null;
	portals: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; at: number }[];
	idle: THREE.Color;
	hot: THREE.Color;
	hotValue: number;
	warmValue: number;
	flash: number[];
}

interface PacketPart {
	group: THREE.Group;
	core: THREE.Mesh;
	coreMaterial: THREE.MeshBasicMaterial;
	halo: THREE.Sprite;
	trail: THREE.Mesh[];
	trailMaterial: THREE.MeshBasicMaterial;
	label: THREE.Sprite | null;
	route: RoutePart;
}

export interface FrameInfo {
	time: number;
	duration: number;
	step: number;
	playing: boolean;
}

export interface StageCallbacks {
	onFrame?: (info: FrameInfo) => void;
	onCue?: (cue: AudioCue) => void;
	onEnd?: () => void;
	onFollowChange?: (following: boolean) => void;
}

const FOV = 26;
const DEG = Math.PI / 180;
const ISO_ELEVATION = Math.atan(Math.SQRT1_2);
/** How visible an unfocused plate stays when it sits below, or above, the plate in focus. */
const GHOST_BELOW = 0.14;
const GHOST_ABOVE = 0.035;
const PLATE_VEIL = 0.38;

function mixValue(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

function plateShape(
	x: number,
	z: number,
	width: number,
	depth: number,
	radius: number
): THREE.Shape {
	// Shape y maps to world -z once the geometry is rotated flat.
	const left = x;
	const right = x + width;
	const top = -z;
	const bottom = -(z + depth);
	const r = Math.min(radius, width / 2, depth / 2);
	const shape = new THREE.Shape();
	shape.moveTo(left + r, bottom);
	shape.lineTo(right - r, bottom);
	if (r > 0) shape.absarc(right - r, bottom + r, r, -Math.PI / 2, 0, false);
	shape.lineTo(right, top - r);
	if (r > 0) shape.absarc(right - r, top - r, r, 0, Math.PI / 2, false);
	shape.lineTo(left + r, top);
	if (r > 0) shape.absarc(left + r, top - r, r, Math.PI / 2, Math.PI, false);
	shape.lineTo(left, bottom + r);
	if (r > 0) shape.absarc(left + r, bottom + r, r, Math.PI, Math.PI * 1.5, false);
	return shape;
}

function slab(shape: THREE.Shape, thickness: number): THREE.ExtrudeGeometry {
	const geometry = new THREE.ExtrudeGeometry(shape, {
		depth: thickness,
		bevelEnabled: false,
		curveSegments: 10
	});
	geometry.rotateX(-Math.PI / 2);
	return geometry;
}

/** Owns the WebGL scene. Reads its state from a Director each frame, and owns no timing. */
export class Stage {
	readonly canvas: HTMLCanvasElement;
	readonly renderer: THREE.WebGLRenderer;
	private readonly scene3d = new THREE.Scene();
	private readonly perspective = new THREE.PerspectiveCamera(FOV, 1, 0.5, 800);
	private readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 800);
	private camera: THREE.Camera = this.perspective;
	private composer: EffectComposer | null = null;
	private bloomPass: UnrealBloomPass | null = null;
	private readonly keyLight = new THREE.DirectionalLight('#ffffff', 2.4);
	private readonly fillLight = new THREE.HemisphereLight('#ffffff', '#888888', 1.5);

	private stack = new THREE.Group();
	/** Draw-order groups. Three sorts by group first, so plates paint deepest to shallowest. */
	private routeGroup = new THREE.Group();
	private labelGroup = new THREE.Group();
	private packetGroup = new THREE.Group();
	private contactShadows: THREE.Mesh[] = [];
	private contactMap: THREE.CanvasTexture | null = null;
	private layers: LayerPart[] = [];
	private nodes = new Map<string, NodePart>();
	private routes = new Map<string, RoutePart>();
	private packets: PacketPart[] = [];
	private disposables: { dispose(): void }[] = [];

	private sceneModel: Scene | null = null;
	private theme: Theme | null = null;
	director: Director | null = null;
	view: ViewOptions = { ...DEFAULT_VIEW };

	private width = 1;
	private height = 1;
	private insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
	private dirty = true;
	private exporting = false;
	private idleClock = 0;
	callbacks: StageCallbacks = {};

	/** The camera the timeline wants. Blended with a free camera when the user takes over. */
	private free: CameraState = { x: 0, y: 0, z: 0, radius: 10, azimuth: 0.6, elevation: 0.5 };
	private followBlend = 1;
	private focusOverride: number | 'all' | null = null;
	private overrideMix = 0;
	private user = { azimuth: 0, elevation: 0, zoom: 1, panX: 0, panY: 0 };
	private reducedMotion = false;

	private readonly tick = (): void => this.frame();
	private readonly cleanup: (() => void)[] = [];

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: false,
			powerPreference: 'high-performance'
		});
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.NoToneMapping;

		this.keyLight.position.set(9, 30, 14);
		this.scene3d.add(this.keyLight, this.keyLight.target, this.fillLight, this.stack);

		const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
		this.reducedMotion = motion.matches;

		this.bindPointer();
		gsap.ticker.add(this.tick);
		this.cleanup.push(() => gsap.ticker.remove(this.tick));
	}

	get following(): boolean {
		return this.followBlend > 0.5;
	}

	resize(width: number, height: number): void {
		if (this.exporting) return;
		this.width = Math.max(1, width);
		this.height = Math.max(1, height);
		const ratio = Math.min(window.devicePixelRatio, 2);
		this.renderer.setPixelRatio(ratio);
		this.renderer.setSize(this.width, this.height, false);
		this.composer?.setPixelRatio(ratio);
		this.composer?.setSize(this.width, this.height);
		this.applyProjection();
		this.dirty = true;
	}

	setInsets(insets: Insets): void {
		this.insets = insets;
		this.applyProjection();
		this.dirty = true;
	}

	private applyProjection(): void {
		const { width, height, insets } = this;
		this.perspective.aspect = width / height;
		// Shift the projection so the subject centres in the space the panels leave free.
		const shiftX = (insets.right - insets.left) / 2;
		const shiftY = (insets.bottom - insets.top) / 2;
		this.perspective.setViewOffset(width, height, shiftX, shiftY, width, height);
		this.perspective.updateProjectionMatrix();
		this.orthographic.setViewOffset(width, height, shiftX, shiftY, width, height);
	}

	setView(view: ViewOptions): void {
		const needsBloom = view.bloom !== this.view.bloom;
		const needsLabels = view.labels !== this.view.labels;
		this.view = { ...view };
		this.camera = view.isometric ? this.orthographic : this.perspective;
		if (needsBloom) this.configureBloom();
		if (this.composer) {
			const pass = this.composer.passes[0] as RenderPass;
			pass.camera = this.camera;
		}
		if (needsLabels) this.applyLabelVisibility();
		for (const blob of this.contactShadows) blob.visible = view.shadows;
		this.dirty = true;
	}

	private applyLabelVisibility(): void {
		for (const part of this.layers) {
			for (const sprite of part.labelSprites)
				sprite.visible = this.view.labels && part.group.visible;
		}
	}

	private contactTexture(): THREE.CanvasTexture {
		this.contactMap ??= makeContactShadow();
		return this.contactMap;
	}

	private configureBloom(): void {
		const strength = this.theme?.bloom ?? 0;
		this.composer?.dispose();
		this.composer = null;
		this.bloomPass = null;
		if (strength <= 0 || !this.view.bloom) return;
		const target = new THREE.WebGLRenderTarget(this.width, this.height, {
			type: THREE.HalfFloatType,
			samples: 4
		});
		const composer = new EffectComposer(this.renderer, target);
		composer.setPixelRatio(this.renderer.getPixelRatio());
		composer.setSize(this.width, this.height);
		composer.addPass(new RenderPass(this.scene3d, this.camera));
		this.bloomPass = new UnrealBloomPass(
			new THREE.Vector2(this.width, this.height),
			strength,
			0.5,
			0.88
		);
		composer.addPass(this.bloomPass);
		composer.addPass(new OutputPass());
		this.composer = composer;
	}

	private track<T extends { dispose(): void }>(item: T): T {
		this.disposables.push(item);
		return item;
	}

	private clear(): void {
		this.director?.dispose();
		this.director = null;
		this.scene3d.remove(this.stack);
		this.stack.traverse((object) => {
			const mesh = object as THREE.Mesh;
			mesh.geometry?.dispose();
			const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
			if (Array.isArray(material)) material.forEach((item) => item.dispose());
			else material?.dispose();
		});
		for (const item of this.disposables) item.dispose();
		this.disposables = [];
		this.stack = new THREE.Group();
		this.routeGroup = new THREE.Group();
		this.routeGroup.renderOrder = 100;
		this.labelGroup = new THREE.Group();
		this.labelGroup.renderOrder = 110;
		this.packetGroup = new THREE.Group();
		this.packetGroup.renderOrder = 120;
		this.stack.add(this.routeGroup, this.labelGroup, this.packetGroup);
		this.scene3d.add(this.stack);
		this.contactShadows = [];
		this.layers = [];
		this.nodes.clear();
		this.routes.clear();
		this.packets = [];
	}

	/** Rebuilds everything. Theme and diagram changes both land here, because it is cheap enough. */
	load(scene: Scene, script: Script, theme: Theme, hiddenLayers: number[] = []): void {
		this.clear();
		this.sceneModel = scene;
		this.theme = theme;

		const backdrop = this.track(makeBackdrop(theme));
		this.scene3d.background = backdrop;
		this.fillLight.color.set(
			theme.mode === 'light' ? '#ffffff' : mix(theme.skyTop, '#ffffff', 0.5)
		);
		this.fillLight.groundColor.set(theme.skyBottom);
		this.fillLight.intensity = theme.mode === 'light' ? 1.7 : 1.5;
		this.keyLight.intensity = theme.mode === 'light' ? 2.1 : 2.5;

		const hidden = new Set(hiddenLayers);
		for (const layer of scene.layers) this.buildLayer(layer, scene, theme, hidden.has(layer.index));
		for (const zone of scene.zones) this.buildZone(zone, scene, theme);
		for (const node of scene.nodes) this.buildNode(node, theme);
		for (const route of scene.routes) {
			if (route.layers.some((index) => hidden.has(index))) continue;
			this.buildRoute(route, theme);
		}

		const { radius, center } = scene.bounds;
		this.keyLight.target.position.set(...center);
		this.keyLight.position.set(center[0] + 9, center[1] + radius + 20, center[2] + 14);
		this.keyLight.target.updateMatrixWorld();

		this.configureBloom();

		this.director = new Director(scene, script, {
			onCue: (cue) => this.callbacks.onCue?.(cue),
			onEnd: () => this.callbacks.onEnd?.()
		});
		for (const { packet } of this.director.packetIndex)
			this.buildPacket(packet.route, packet.label, packet.payload, theme);

		this.applyLabelVisibility();
		this.dirty = true;
	}

	private buildLayer(layer: PlacedLayer, scene: Scene, theme: Theme, hidden: boolean): void {
		const group = new THREE.Group();
		group.visible = !hidden;
		group.renderOrder = scene.layers.length - layer.index;
		const color = layerColor(theme, layer.index);
		const part: LayerPart = {
			group,
			fades: [],
			labels: [],
			labelSprites: [],
			depthWriters: [],
			surfaces: [],
			surfaceWriters: [],
			factor: 1,
			shadowMaterial: null
		};
		const { x, z, width, depth } = layer.rect;
		const thick = scene.plateThickness;
		const radius = theme.radius > 0 ? 0.6 : 0;

		const shape = plateShape(x, z, width, depth, radius);
		const geometry = slab(shape, thick);
		// In a dark satin theme a plate is smoked glass, so its colour lives in the print and edges.
		const glass = theme.mode === 'dark' && theme.finish === 'satin';
		const surface = glass ? mix(color, theme.skyBottom, 0.84) : color;
		const material = new THREE.MeshStandardMaterial({
			color: surface,
			transparent: true,
			opacity: theme.plateOpacity,
			roughness: theme.finish === 'faceted' ? 0.9 : 0.5,
			metalness: 0,
			flatShading: theme.finish === 'faceted',
			depthWrite: theme.plateOpacity > 0.5
		});
		if (theme.plateOpacity > 0.5) part.surfaceWriters.push(material);
		const plate = new THREE.Mesh(geometry, material);
		plate.position.y = layer.y - thick / 2;
		group.add(plate);
		part.surfaces.push({ material, base: theme.plateOpacity });

		const edgeMaterial = new THREE.LineBasicMaterial({
			color: theme.mode === 'light' ? theme.ink : mix(color, '#ffffff', 0.35),
			transparent: true,
			depthWrite: false,
			opacity: Math.max(theme.outline, 0.5)
		});
		const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), edgeMaterial);
		edges.position.copy(plate.position);
		group.add(edges);
		part.fades.push({ material: edgeMaterial, base: edgeMaterial.opacity });

		const printInk = glass
			? color
			: theme.finish === 'wire'
				? theme.ink
				: readableOn(color, theme.mode === 'light' ? theme.ink : '#10101c', '#ffffff');
		const texture = this.track(makePlateTexture(theme, layer.index + 1, width / depth, printInk));
		const printMaterial = new THREE.MeshBasicMaterial({
			map: texture,
			transparent: true,
			depthWrite: false,
			toneMapped: false
		});
		const printGeometry = new THREE.PlaneGeometry(width, depth);
		printGeometry.rotateX(-Math.PI / 2);
		const print = new THREE.Mesh(printGeometry, printMaterial);
		print.position.set(x + width / 2, layer.y + thick / 2 + 0.004, z + depth / 2);
		print.renderOrder = 1;
		group.add(print);
		part.surfaces.push({ material: printMaterial, base: 1 });

		const title = makePrintedText(layer.title, theme, {
			size: 0.95,
			weight: 700,
			stretch: 'expanded',
			color: printInk
		});
		title.position.set(x + 0.7, layer.y + thick / 2 + 0.008, z + depth - 0.85);
		title.renderOrder = 2;
		group.add(title);
		part.fades.push({ material: title.material as THREE.Material, base: 1 });

		this.stack.add(group);
		this.layers[layer.index] = part;
	}

	private buildZone(zone: PlacedZone, scene: Scene, theme: Theme): void {
		const part = this.layers[zone.layerIndex];
		const layer = scene.layers[zone.layerIndex];
		const { x, z, width, depth } = zone.rect;
		const step = 0.07;
		const color = layerColor(theme, zone.layerIndex);
		const shape = plateShape(x, z, width, depth, theme.radius > 0 ? 0.35 : 0);
		const geometry = slab(shape, step);
		const glass = theme.mode === 'dark' && theme.finish === 'satin';
		const fill =
			theme.finish === 'wire'
				? theme.skyBottom
				: glass
					? mix(color, theme.skyBottom, 0.74 - zone.depth * 0.06)
					: mix(
							color,
							theme.mode === 'light' ? '#ffffff' : theme.skyBottom,
							0.3 + zone.depth * 0.14
						);
		const opacity = theme.finish === 'wire' ? 0.28 : 0.88;
		const material = new THREE.MeshStandardMaterial({
			color: fill,
			transparent: true,
			opacity,
			roughness: 0.6,
			flatShading: theme.finish === 'faceted'
		});
		const mesh = new THREE.Mesh(geometry, material);
		const top = layer.y + scene.plateThickness / 2 + zone.depth * step;
		mesh.position.y = top - step;
		part.group.add(mesh);
		part.surfaces.push({ material, base: opacity });

		const line = new THREE.LineBasicMaterial({
			color: theme.ink,
			transparent: true,
			depthWrite: false,
			opacity: 0.5
		});
		const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), line);
		lines.position.copy(mesh.position);
		part.group.add(lines);
		part.fades.push({ material: line, base: 0.5 });

		const ink =
			theme.finish === 'wire' || glass
				? theme.ink
				: readableOn(fill, theme.mode === 'light' ? theme.ink : '#10101c', '#ffffff');
		const title = makePrintedText(zone.title, theme, { size: 0.42, weight: 600, color: ink });
		title.position.set(x + 0.32, top + 0.006, z + 0.45);
		title.renderOrder = 2;
		part.group.add(title);
		part.fades.push({ material: title.material as THREE.Material, base: 1 });
	}

	private buildNode(node: PlacedNode, theme: Theme): void {
		const layer = this.layers[node.layerIndex];
		const color = layerColor(theme, node.layerIndex);
		const materials = makeNodeMaterials(theme, color);
		const shape = buildNodeShape(node.kind, materials, theme);
		shape.scale.setScalar(SHAPE_SCALE);
		const root = new THREE.Group();
		// Three restarts its sort key at each nested group, so nested groups must repeat the order.
		root.renderOrder = shape.renderOrder = layer.group.renderOrder;
		root.position.set(...node.position);
		root.add(shape);

		if (!layer.shadowMaterial) {
			layer.shadowMaterial = new THREE.MeshBasicMaterial({
				map: this.contactTexture(),
				transparent: true,
				depthWrite: false,
				toneMapped: false,
				opacity: theme.mode === 'light' ? 0.42 : 0.62
			});
			layer.fades.push({ material: layer.shadowMaterial, base: layer.shadowMaterial.opacity });
		}
		const blobGeometry = new THREE.PlaneGeometry(1, 1);
		blobGeometry.rotateX(-Math.PI / 2);
		const blob = new THREE.Mesh(blobGeometry, layer.shadowMaterial);
		blob.scale.setScalar(3.1);
		blob.position.set(0.12, 0.012, 0.1);
		blob.renderOrder = 3;
		blob.visible = this.view.shadows;
		root.add(blob);
		this.contactShadows.push(blob);

		for (const key of ['body', 'accent', 'dark'] as const) {
			materials[key].emissive.set(theme.packet);
			materials[key].emissiveIntensity = 0;
			layer.fades.push({ material: materials[key], base: materials[key].opacity });
			layer.depthWriters.push(materials[key]);
		}
		layer.fades.push({ material: materials.line, base: materials.line.opacity });

		const ringMaterial = new THREE.MeshBasicMaterial({
			color: theme.packet,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			toneMapped: false,
			side: THREE.DoubleSide
		});
		const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.36, 48), ringMaterial);
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.02;
		ring.visible = false;
		root.add(ring);

		const label = makeLabel({
			text: node.label,
			sub: node.detail,
			ink: theme.ink,
			background: `${theme.panel}e0`,
			radius: theme.radius,
			font: theme.font
		});
		label.position.set(
			node.position[0],
			node.position[1] + shapeHeight(node.kind) + 0.2,
			node.position[2]
		);
		this.labelGroup.add(label);
		layer.labels.push(label.material);
		layer.labelSprites.push(label);

		layer.group.add(root);
		this.nodes.set(node.id, {
			root,
			shape,
			emissive: [materials.body, materials.accent, materials.dark],
			ring,
			ringMaterial,
			layer: node.layerIndex,
			heat: 0,
			ringValue: 0
		});
	}

	private buildRoute(route: Route, theme: Theme): void {
		const curve = new THREE.CatmullRomCurve3(
			route.points.map((point) => new THREE.Vector3(...point))
		);
		curve.curveType = 'centripetal';
		const segments = route.kind === 'cross' ? 72 : 56;
		const radius = route.style === 'thick' ? 0.075 : 0.042;
		const geometry = new THREE.TubeGeometry(curve, segments, radius, 7, false);
		const idle = new THREE.Color(
			theme.mode === 'light'
				? mix(theme.ink, theme.inkSoft, 0.4)
				: mix(theme.ink, theme.skyTop, 0.2)
		);
		const material = new THREE.MeshBasicMaterial({
			color: idle.clone(),
			transparent: true,
			depthWrite: false,
			opacity: 0.5,
			toneMapped: false
		});
		if (route.style === 'dashed') {
			const dashes = this.track(makeDashes());
			dashes.repeat.x = Math.max(2, route.length / 0.55);
			material.alphaMap = dashes;
			material.alphaTest = 0.4;
		}
		const mesh = new THREE.Mesh(geometry, material);
		this.routeGroup.add(mesh);

		let arrow: THREE.Mesh | null = null;
		let arrowMaterial: THREE.MeshBasicMaterial | null = null;
		if (route.directed && route.kind !== 'self') {
			const t = Math.max(0.5, 1 - 1.35 / curve.getLength());
			const cone = new THREE.ConeGeometry(radius * 3.4, radius * 8, 14);
			// Its own material, because a dash mask on a cone just shatters the arrowhead.
			arrowMaterial = new THREE.MeshBasicMaterial({
				color: idle.clone(),
				transparent: true,
				depthWrite: false,
				opacity: 0.5,
				toneMapped: false
			});
			arrow = new THREE.Mesh(cone, arrowMaterial);
			arrow.position.copy(curve.getPointAt(t));
			arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(t));
			arrow.renderOrder = 3;
			this.routeGroup.add(arrow);
		}

		const portals: RoutePart['portals'] = [];
		for (const crossing of route.crossings) {
			const portalMaterial = new THREE.MeshBasicMaterial({
				color: theme.packet,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				toneMapped: false,
				side: THREE.DoubleSide
			});
			const portal = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.33, 40), portalMaterial);
			portal.rotation.x = -Math.PI / 2;
			portal.position.set(...crossing.position);
			portal.position.y += 0.12;
			portal.renderOrder = 4;
			this.routeGroup.add(portal);
			portals.push({
				mesh: portal,
				material: portalMaterial,
				at: nearestParameter(curve, portal.position)
			});
		}

		this.routes.set(route.id, {
			route,
			curve,
			mesh,
			material,
			arrow,
			arrowMaterial,
			portals,
			idle,
			hot: new THREE.Color(theme.packet),
			hotValue: 0,
			warmValue: 0,
			flash: portals.map(() => 0)
		});
	}

	private buildPacket(
		routeId: string,
		labelText: string,
		payload: PayloadKind,
		theme: Theme
	): void {
		const route = this.routes.get(routeId);
		const group = new THREE.Group();
		group.renderOrder = this.packetGroup.renderOrder;
		group.visible = false;
		const color =
			payload === 'credential'
				? theme.credential
				: payload === 'error'
					? theme.error
					: theme.packet;
		const coreMaterial = new THREE.MeshBasicMaterial({
			color,
			toneMapped: false,
			transparent: true
		});
		const geometry =
			payload === 'credential'
				? new THREE.OctahedronGeometry(0.26)
				: payload === 'error'
					? new THREE.TetrahedronGeometry(0.3)
					: new THREE.BoxGeometry(0.33, 0.33, 0.33);
		const core = new THREE.Mesh(geometry, coreMaterial);
		core.renderOrder = 6;
		group.add(core);

		const haloTexture = this.track(makeHalo(color));
		const haloMaterial = new THREE.SpriteMaterial({
			map: haloTexture,
			transparent: true,
			depthWrite: false,
			toneMapped: false,
			blending: theme.mode === 'light' ? THREE.NormalBlending : THREE.AdditiveBlending
		});
		const halo = new THREE.Sprite(haloMaterial);
		halo.scale.setScalar(1.25);
		halo.renderOrder = 5;
		group.add(halo);

		let label: THREE.Sprite | null = null;
		if (labelText) {
			label = makeLabel({
				text: labelText,
				ink: readableOn(color, '#101018', '#ffffff'),
				background: color,
				radius: theme.radius,
				font: theme.font,
				weight: 660
			});
			label.scale.multiplyScalar(0.92);
			label.position.y = 0.32;
			label.material.depthTest = false;
			label.renderOrder = 20;
			group.add(label);
		}
		this.packetGroup.add(group);

		const trailMaterial = new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 0.5,
			toneMapped: false,
			depthWrite: false
		});
		const trailGeometry = this.track(new THREE.SphereGeometry(0.1, 10, 8));
		const trail: THREE.Mesh[] = [];
		for (let index = 0; index < 7; index++) {
			const puff = new THREE.Mesh(trailGeometry, trailMaterial);
			puff.visible = false;
			puff.renderOrder = 5;
			this.packetGroup.add(puff);
			trail.push(puff);
		}
		if (route) {
			this.packets.push({ group, core, coreMaterial, halo, trail, trailMaterial, label, route });
		} else {
			// Its route sits on a hidden plate, which should not happen because the script filters those.
			throw new Error(`Packet references a route that was not built: ${routeId}`);
		}
	}

	/** Applies the director's state to scene objects. Pure, given the same state. */
	private applyState(): void {
		const director = this.director;
		if (!director) return;
		const state = director.state;

		this.stack.scale.y = state.rise;

		const override = this.focusOverride;
		const focusOf = (index: number): number => {
			const timeline = state.focus[`l${index}`] ?? 1;
			if (override === null) return timeline;
			const manual = override === 'all' || override === index ? 1 : 0;
			return mixValue(timeline, manual, this.overrideMix);
		};
		// Plates above the focus sit between it and the camera, so they fade the furthest.
		let focusBeneath = 0;
		for (let index = this.layers.length - 1; index >= 0; index--) {
			const part = this.layers[index];
			const focus = focusOf(index);
			const ghost = mixValue(GHOST_BELOW, GHOST_ABOVE, focusBeneath);
			const factor = this.view.ghost ? mixValue(ghost, 1, focus) : 1;
			part.factor = factor;
			for (const { material, base } of part.fades) material.opacity = base * factor;
			// A plate with focus beneath it turns to thin glass, so nothing below gets hidden.
			const veil = this.view.ghost ? mixValue(1, PLATE_VEIL, focusBeneath) : 1;
			for (const { material, base } of part.surfaces) material.opacity = base * factor * veil;
			for (const label of part.labels) label.opacity = this.view.ghost ? Math.pow(focus, 2) : 1;
			const writes = factor > 0.97;
			for (const material of part.depthWriters) material.depthWrite = writes;
			for (const material of part.surfaceWriters) material.depthWrite = writes && veil > 0.97;
			focusBeneath = Math.max(focusBeneath, focus);
		}

		for (const node of this.nodes.values()) {
			node.heat = 0;
			node.ringValue = 0;
		}
		for (const source of state.sourceGlow) {
			const node = this.nodes.get(source.node);
			if (node) node.heat = Math.max(node.heat, source.value * 0.55);
		}
		for (const arrival of state.arrivals) {
			if (arrival.ring <= 0 || arrival.ring >= 1) continue;
			const node = this.nodes.get(arrival.node);
			if (!node) continue;
			node.heat = Math.max(node.heat, Math.sin(arrival.ring * Math.PI));
			node.ringValue = Math.max(node.ringValue, arrival.ring);
		}
		for (const node of this.nodes.values()) {
			for (const material of node.emissive) material.emissiveIntensity = node.heat * 0.85;
			node.shape.scale.setScalar(SHAPE_SCALE * (1 + node.heat * 0.11));
			node.ring.visible = node.ringValue > 0;
			if (node.ringValue > 0) {
				node.ring.scale.setScalar(0.7 + node.ringValue * 1.5);
				node.ringMaterial.opacity = (1 - node.ringValue) * 0.9;
			}
		}

		for (const route of this.routes.values()) {
			route.hotValue = 0;
			route.warmValue = 0;
			route.flash.fill(0);
		}
		director.packetIndex.forEach(({ packet }, index) => {
			const route = this.routes.get(packet.route);
			if (!route) return;
			const activity = state.activity[index];
			route.hotValue = Math.max(route.hotValue, activity.hot);
			route.warmValue = Math.max(route.warmValue, activity.warm);
		});

		const position = new THREE.Vector3();
		this.packets.forEach((packet, index) => {
			const progress = state.packets[index].progress;
			const active = progress > 0 && progress < 1;
			packet.group.visible = active;
			const curve = packet.route.curve;
			if (active) {
				curve.getPointAt(progress, position);
				packet.group.position.copy(position);
				packet.core.rotation.set(progress * 9, progress * 12, 0);
				if (packet.label) packet.label.visible = this.view.packetLabels;
				packet.route.portals.forEach((portal, portalIndex) => {
					const distance = (progress - portal.at) / 0.07;
					packet.route.flash[portalIndex] = Math.max(
						packet.route.flash[portalIndex],
						Math.exp(-distance * distance)
					);
				});
			}
			packet.trail.forEach((puff, puffIndex) => {
				const behind = progress - (puffIndex + 1) * (0.28 / Math.max(3, curve.getLength()));
				const show = active && behind > 0;
				puff.visible = show;
				if (show) {
					curve.getPointAt(behind, puff.position);
					puff.scale.setScalar(1 - puffIndex * 0.12);
				}
			});
		});

		for (const route of this.routes.values()) {
			const fade = Math.max(...route.route.layers.map((index) => this.layers[index]?.factor ?? 1));
			const heat = Math.max(route.hotValue, route.warmValue * 0.42);
			route.material.color.copy(route.idle).lerp(route.hot, heat);
			const idleOpacity = this.view.idleRoutes ? 0.5 : 0;
			const opacity = Math.max(idleOpacity * fade, route.hotValue, route.warmValue * 0.65 * fade);
			route.material.opacity = opacity;
			route.mesh.visible = opacity > 0.005;
			if (route.arrow && route.arrowMaterial) {
				route.arrow.visible = route.mesh.visible;
				route.arrowMaterial.color.copy(route.material.color);
				route.arrowMaterial.opacity = opacity;
			}
			route.portals.forEach((portal, index) => {
				const flash = route.flash[index];
				portal.material.opacity = Math.max(route.hotValue * 0.75, flash) * Math.max(fade, 0.3);
				portal.mesh.scale.setScalar(1 + flash * 1.8);
				portal.mesh.visible = portal.material.opacity > 0.01;
			});
		}
	}

	private applyCamera(idle: number): void {
		const director = this.director;
		if (!director) return;
		const timeline = director.state.camera;
		const blend = this.followBlend;
		const free = this.free;
		const { user } = this;

		let azimuth = mixValue(free.azimuth, timeline.azimuth, blend) + user.azimuth;
		let elevation = mixValue(free.elevation, timeline.elevation, blend) + user.elevation;
		const radius = mixValue(free.radius, timeline.radius, blend) * user.zoom;
		const target = new THREE.Vector3(
			mixValue(free.x, timeline.x, blend),
			mixValue(free.y, timeline.y, blend),
			mixValue(free.z, timeline.z, blend)
		);
		if (this.view.drift && !this.reducedMotion && !this.exporting)
			azimuth += Math.sin(idle * 0.13) * 0.022;

		if (this.view.isometric) {
			azimuth = 45 * DEG + user.azimuth;
			elevation = ISO_ELEVATION + user.elevation;
		}
		elevation = clamp(elevation, -8 * DEG, 88 * DEG);

		const { width, height, insets } = this;
		const usableWidth = Math.max(40, width - insets.left - insets.right);
		const usableHeight = Math.max(40, height - insets.top - insets.bottom);
		const aspect = width / height;
		const heightFit = height / usableHeight;
		const widthFit = width / usableWidth;

		const direction = new THREE.Vector3(
			Math.sin(azimuth) * Math.cos(elevation),
			Math.sin(elevation),
			Math.cos(azimuth) * Math.cos(elevation)
		);
		const right = new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth));
		const up = new THREE.Vector3().crossVectors(direction, right).normalize();
		target.addScaledVector(right, user.panX).addScaledVector(up, user.panY);

		if (this.view.isometric) {
			const half = Math.max(radius * heightFit, (radius * widthFit) / aspect) * 1.02;
			const camera = this.orthographic;
			camera.left = -half * aspect;
			camera.right = half * aspect;
			camera.top = half;
			camera.bottom = -half;
			camera.position.copy(target).addScaledVector(direction, 200);
			camera.lookAt(target);
			camera.updateProjectionMatrix();
		} else {
			const halfV = (FOV / 2) * DEG;
			const halfH = Math.atan(Math.tan(halfV) * aspect);
			const distance = Math.max(
				(radius * heightFit) / Math.sin(halfV),
				(radius * widthFit) / Math.sin(halfH)
			);
			const camera = this.perspective;
			camera.position.copy(target).addScaledVector(direction, distance);
			camera.lookAt(target);
		}
	}

	private currentCameraValues(): CameraState {
		const timeline = this.director?.state.camera ?? this.free;
		const blend = this.followBlend;
		const free = this.free;
		return {
			x: mixValue(free.x, timeline.x, blend),
			y: mixValue(free.y, timeline.y, blend),
			z: mixValue(free.z, timeline.z, blend),
			radius: mixValue(free.radius, timeline.radius, blend),
			azimuth: mixValue(free.azimuth, timeline.azimuth, blend),
			elevation: mixValue(free.elevation, timeline.elevation, blend)
		};
	}

	/** Pans to one plate and leaves the camera there, so the story can play on without moving it. */
	panToLayer(index: number | 'all'): void {
		const scene = this.sceneModel;
		if (!scene) return;
		this.free = this.currentCameraValues();
		this.followBlend = 0;
		this.callbacks.onFollowChange?.(false);
		this.focusOverride = index;
		gsap.killTweensOf(this.free);
		gsap.to(this, {
			overrideMix: 1,
			duration: 0.7,
			ease: 'power1.inOut',
			onUpdate: () => this.markDirty()
		});
		let goal: CameraState;
		if (index === 'all') {
			const shot = this.director?.script.overview;
			if (!shot) return;
			goal = {
				x: shot.target[0],
				y: shot.target[1],
				z: shot.target[2],
				radius: shot.radius,
				azimuth: shot.azimuth,
				elevation: shot.elevation
			};
		} else {
			const layer = scene.layers[index];
			if (!layer) return;
			goal = {
				x: 0,
				y: layer.y + 0.5,
				z: 0,
				radius: Math.hypot(layer.rect.width, layer.rect.depth) * 0.42,
				azimuth: 38 * DEG,
				elevation: 38 * DEG
			};
		}
		gsap.to(this.free, {
			...goal,
			duration: this.reducedMotion ? 0.01 : 1.1,
			ease: 'power2.inOut',
			onUpdate: () => this.markDirty()
		});
	}

	/** The plate the free camera is closest to, or the one in the current step. */
	currentLayer(): number {
		if (typeof this.focusOverride === 'number') return this.focusOverride;
		const director = this.director;
		if (!director) return 0;
		const step = director.script.steps[director.stepAt(director.time)];
		return step?.layers[0] ?? 0;
	}

	setFollow(on: boolean): void {
		if (on === this.following && !(on && this.focusOverride !== null)) return;
		gsap.killTweensOf(this, 'followBlend,overrideMix');
		if (on) {
			gsap.killTweensOf(this.free);
			gsap.to(this, {
				followBlend: 1,
				overrideMix: 0,
				duration: this.reducedMotion ? 0.01 : 0.9,
				ease: 'power2.inOut',
				onUpdate: () => this.markDirty(),
				onComplete: () => {
					this.focusOverride = null;
				}
			});
		} else {
			this.free = this.currentCameraValues();
			this.followBlend = 0;
		}
		this.callbacks.onFollowChange?.(on);
		this.dirty = true;
	}

	zoomBy(factor: number): void {
		const next = clamp(this.user.zoom * factor, 0.2, 3.2);
		gsap.to(this.user, {
			zoom: next,
			duration: 0.3,
			ease: 'power2.out',
			onUpdate: () => this.markDirty()
		});
	}

	resetCamera(): void {
		gsap.to(this.user, {
			azimuth: 0,
			elevation: 0,
			zoom: 1,
			panX: 0,
			panY: 0,
			duration: 0.6,
			ease: 'power2.inOut',
			onUpdate: () => this.markDirty()
		});
	}

	markDirty(): void {
		this.dirty = true;
	}

	private frame(): void {
		if (this.exporting || !this.director) return;
		this.director.update();
		const { director } = this;
		const playing = director.playing;
		const motion = this.view.drift && !this.reducedMotion;
		if (playing || motion) this.idleClock += gsap.ticker.deltaRatio(60) / 60;
		if (playing || this.dirty || motion) {
			this.applyState();
			this.applyCamera(this.idleClock);
			this.draw();
			this.dirty = false;
		}
		const step = director.stepAt(director.time);
		this.callbacks.onFrame?.({ time: director.time, duration: director.duration, step, playing });
	}

	private draw(): void {
		if (this.composer) this.composer.render();
		else this.renderer.render(this.scene3d, this.camera);
	}

	/** Swaps the output size for an offline render, returning a function that restores it. */
	beginCapture(width: number, height: number): () => void {
		this.exporting = true;
		const previous = {
			width: this.width,
			height: this.height,
			insets: this.insets,
			ratio: this.renderer.getPixelRatio(),
			user: { ...this.user },
			blend: this.followBlend,
			override: this.focusOverride,
			mix: this.overrideMix
		};
		this.width = width;
		this.height = height;
		this.insets = { left: 0, right: 0, top: 0, bottom: 0 };
		this.followBlend = 1;
		this.focusOverride = null;
		this.overrideMix = 0;
		Object.assign(this.user, { azimuth: 0, elevation: 0, zoom: 1, panX: 0, panY: 0 });
		this.renderer.setPixelRatio(1);
		this.renderer.setSize(width, height, false);
		this.composer?.setPixelRatio(1);
		this.composer?.setSize(width, height);
		this.applyProjection();
		return () => {
			this.width = previous.width;
			this.height = previous.height;
			this.insets = previous.insets;
			this.followBlend = previous.blend;
			this.focusOverride = previous.override;
			this.overrideMix = previous.mix;
			Object.assign(this.user, previous.user);
			this.renderer.setPixelRatio(previous.ratio);
			this.renderer.setSize(previous.width, previous.height, false);
			this.composer?.setPixelRatio(previous.ratio);
			this.composer?.setSize(previous.width, previous.height);
			this.applyProjection();
			this.exporting = false;
			this.dirty = true;
		};
	}

	/** Renders exactly one frame at the given time. Call between beginCapture and its restore. */
	captureFrame(time: number): void {
		const director = this.director;
		if (!director) return;
		director.timeline.seek(time, true);
		this.applyState();
		this.applyCamera(0);
		this.draw();
	}

	dispose(): void {
		this.clear();
		for (const undo of this.cleanup) undo();
		this.contactMap?.dispose();
		this.composer?.dispose();
		this.renderer.dispose();
	}

	private bindPointer(): void {
		const element = this.canvas;
		const pointers = new Map<number, { x: number; y: number }>();
		let pinchStart = 0;
		let zoomStart = 1;

		const onDown = (event: PointerEvent): void => {
			element.setPointerCapture(event.pointerId);
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (pointers.size === 2) {
				const [a, b] = [...pointers.values()];
				pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
				zoomStart = this.user.zoom;
			}
		};
		const onMove = (event: PointerEvent): void => {
			const previous = pointers.get(event.pointerId);
			if (!previous) return;
			const dx = event.clientX - previous.x;
			const dy = event.clientY - previous.y;
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (pointers.size === 2) {
				const [a, b] = [...pointers.values()];
				const distance = Math.hypot(a.x - b.x, a.y - b.y);
				if (pinchStart > 0) this.user.zoom = clamp((zoomStart * pinchStart) / distance, 0.2, 3.2);
			} else if (event.shiftKey || event.buttons === 2 || event.buttons === 4) {
				const scale = this.currentCameraValues().radius * this.user.zoom * (2 / this.height);
				this.user.panX -= dx * scale;
				this.user.panY += dy * scale;
			} else {
				this.user.azimuth -= dx * 0.005;
				this.user.elevation += dy * 0.004;
			}
			this.dirty = true;
		};
		const onUp = (event: PointerEvent): void => {
			pointers.delete(event.pointerId);
		};
		const onWheel = (event: WheelEvent): void => {
			event.preventDefault();
			this.user.zoom = clamp(this.user.zoom * Math.exp(event.deltaY * 0.0012), 0.2, 3.2);
			this.dirty = true;
		};
		const onDouble = (): void => this.resetCamera();
		const onContext = (event: Event): void => event.preventDefault();

		element.addEventListener('pointerdown', onDown);
		element.addEventListener('pointermove', onMove);
		element.addEventListener('pointerup', onUp);
		element.addEventListener('pointercancel', onUp);
		element.addEventListener('wheel', onWheel, { passive: false });
		element.addEventListener('dblclick', onDouble);
		element.addEventListener('contextmenu', onContext);
		this.cleanup.push(() => {
			element.removeEventListener('pointerdown', onDown);
			element.removeEventListener('pointermove', onMove);
			element.removeEventListener('pointerup', onUp);
			element.removeEventListener('pointercancel', onUp);
			element.removeEventListener('wheel', onWheel);
			element.removeEventListener('dblclick', onDouble);
			element.removeEventListener('contextmenu', onContext);
		});
	}
}

function nearestParameter(curve: THREE.Curve<THREE.Vector3>, point: THREE.Vector3): number {
	let best = 0;
	let bestDistance = Infinity;
	const probe = new THREE.Vector3();
	for (let index = 0; index <= 60; index++) {
		const t = index / 60;
		curve.getPointAt(t, probe);
		const distance = probe.distanceToSquared(point);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = t;
		}
	}
	return best;
}
