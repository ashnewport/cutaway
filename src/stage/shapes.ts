import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { NodeKind, Theme } from '../core/index.ts';
import { mix } from './paint.ts';

export interface NodeMaterials {
	body: THREE.MeshStandardMaterial;
	accent: THREE.MeshStandardMaterial;
	dark: THREE.MeshStandardMaterial;
	line: THREE.LineBasicMaterial;
}

export function makeNodeMaterials(theme: Theme, layerColor: string): NodeMaterials {
	const faceted = theme.finish === 'faceted';
	const wire = theme.finish === 'wire';
	const standard = (color: string, opacity = 1) =>
		new THREE.MeshStandardMaterial({
			color,
			roughness: faceted ? 0.8 : 0.48,
			metalness: 0.02,
			flatShading: faceted,
			transparent: true,
			opacity
		});
	const bodyColor =
		theme.mode === 'light' ? mix('#ffffff', layerColor, 0.1) : mix(theme.panel, layerColor, 0.32);
	return {
		body: standard(wire ? theme.skyBottom : bodyColor, wire ? 0.25 : 1),
		accent: standard(layerColor, wire ? 0.5 : 1),
		dark: standard(
			wire ? theme.skyTop : mix(layerColor, theme.mode === 'light' ? theme.ink : '#000000', 0.5),
			wire ? 0.3 : 1
		),
		line: new THREE.LineBasicMaterial({
			color: theme.mode === 'light' ? theme.ink : mix(theme.ink, layerColor, 0.25),
			transparent: true,
			depthWrite: false,
			opacity: theme.outline
		})
	};
}

type Part = 'body' | 'accent' | 'dark';

class Kit {
	readonly group = new THREE.Group();
	readonly materials: NodeMaterials;
	readonly detail: number;

	constructor(materials: NodeMaterials, theme: Theme) {
		this.materials = materials;
		this.detail = theme.finish === 'faceted' ? 8 : 36;
	}

	add(
		geometry: THREE.BufferGeometry,
		part: Part,
		position: [number, number, number] = [0, 0, 0],
		rotation: [number, number, number] = [0, 0, 0],
		edgeAngle = 40
	): THREE.Mesh {
		const mesh = new THREE.Mesh(geometry, this.materials[part]);
		mesh.position.set(...position);
		mesh.rotation.set(...rotation);
		const outline = new THREE.LineSegments(
			new THREE.EdgesGeometry(geometry, edgeAngle),
			this.materials.line
		);
		mesh.add(outline);
		this.group.add(mesh);
		return mesh;
	}

	box(
		w: number,
		h: number,
		d: number,
		part: Part,
		position: [number, number, number],
		rotation?: [number, number, number]
	): THREE.Mesh {
		const geometry = new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.18);
		return this.add(geometry, part, position, rotation, 50);
	}

	cylinder(
		top: number,
		bottom: number,
		h: number,
		part: Part,
		position: [number, number, number],
		rotation?: [number, number, number],
		segments?: number
	): THREE.Mesh {
		return this.add(
			new THREE.CylinderGeometry(top, bottom, h, segments ?? this.detail),
			part,
			position,
			rotation
		);
	}
}

function pad(kit: Kit, radius = 0.72): void {
	kit.cylinder(radius, radius, 0.08, 'dark', [0, 0.04, 0]);
}

const BUILDERS: Record<NodeKind, (kit: Kit) => void> = {
	service(kit) {
		kit.box(1.25, 0.95, 1.05, 'body', [0, 0.48, 0]);
		for (const y of [0.3, 0.52, 0.74]) kit.box(0.92, 0.07, 0.04, 'accent', [0, y, 0.54]);
	},
	function(kit) {
		kit.cylinder(0.62, 0.62, 0.6, 'body', [0, 0.3, 0], undefined, 6);
		const bolt = new THREE.Shape();
		bolt.moveTo(0.06, 0.3);
		bolt.lineTo(-0.16, 0);
		bolt.lineTo(-0.02, 0);
		bolt.lineTo(-0.08, -0.3);
		bolt.lineTo(0.16, 0.06);
		bolt.lineTo(0.02, 0.06);
		bolt.closePath();
		const geometry = new THREE.ExtrudeGeometry(bolt, { depth: 0.1, bevelEnabled: false });
		kit.add(geometry, 'accent', [0, 0.65, 0.02], [-Math.PI / 2, 0, 0.6]);
	},
	database(kit) {
		for (const y of [0.17, 0.53, 0.89]) kit.cylinder(0.64, 0.64, 0.31, 'body', [0, y, 0]);
		for (const y of [0.35, 0.71]) kit.cylinder(0.655, 0.655, 0.05, 'accent', [0, y, 0]);
	},
	storage(kit) {
		kit.cylinder(0.72, 0.5, 0.95, 'body', [0, 0.48, 0]);
		kit.cylinder(0.64, 0.64, 0.02, 'dark', [0, 0.955, 0]);
		const rim = new THREE.TorusGeometry(0.72, 0.05, 10, kit.detail);
		kit.add(rim, 'accent', [0, 0.96, 0], [Math.PI / 2, 0, 0]);
	},
	cache(kit) {
		const offsets: [number, number, number][] = [
			[0, 0.14, 0],
			[0.08, 0.44, -0.05],
			[-0.06, 0.74, 0.05]
		];
		offsets.forEach((position, index) => {
			kit.cylinder(0.62, 0.62, 0.22, index === 1 ? 'accent' : 'body', position);
		});
	},
	queue(kit) {
		kit.box(1.5, 0.1, 0.6, 'dark', [0, 0.05, 0]);
		[-0.51, -0.17, 0.17, 0.51].forEach((x, index) => {
			kit.box(0.28, 0.42, 0.42, index === 3 ? 'accent' : 'body', [x, 0.33, 0]);
		});
	},
	gateway(kit) {
		kit.box(0.26, 0.95, 0.5, 'body', [-0.56, 0.48, 0]);
		kit.box(0.26, 0.95, 0.5, 'body', [0.56, 0.48, 0]);
		const arch = new THREE.TorusGeometry(0.56, 0.13, 12, kit.detail, Math.PI);
		kit.add(arch, 'accent', [0, 0.95, 0]);
	},
	loadbalancer(kit) {
		kit.cylinder(0.72, 0.72, 0.42, 'body', [0, 0.21, 0], undefined, 6);
		kit.cylinder(0.12, 0.12, 0.3, 'accent', [0, 0.57, 0]);
		[-0.55, 0, 0.55].forEach((angle) => {
			kit.cylinder(0.07, 0.07, 0.72, 'accent', [Math.sin(angle) * 0.36, 0.95, 0], [0, 0, -angle]);
			kit.add(new THREE.SphereGeometry(0.13, 16, 12), 'accent', [Math.sin(angle) * 0.72, 1.24, 0]);
		});
	},
	internet(kit) {
		pad(kit, 0.42);
		kit.cylinder(0.05, 0.05, 0.38, 'dark', [0, 0.25, 0]);
		kit.add(new THREE.SphereGeometry(0.46, kit.detail, 20), 'accent', [0, 0.92, 0]);
		const cage = new THREE.LineSegments(
			new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.62, 1), 1),
			kit.materials.line
		);
		cage.position.set(0, 0.92, 0);
		kit.group.add(cage);
	},
	cdn(kit) {
		pad(kit, 0.5);
		kit.add(new THREE.SphereGeometry(0.46, kit.detail, 20), 'body', [0, 0.62, 0]);
		kit.add(
			new THREE.TorusGeometry(0.72, 0.045, 10, kit.detail),
			'accent',
			[0, 0.62, 0],
			[Math.PI / 2.4, 0.2, 0]
		);
		kit.add(new THREE.SphereGeometry(0.1, 12, 10), 'accent', [0.68, 0.74, 0.1]);
	},
	dns(kit) {
		pad(kit, 0.42);
		kit.cylinder(0.06, 0.06, 1.25, 'dark', [0, 0.65, 0]);
		kit.box(1.05, 0.26, 0.08, 'accent', [0.12, 1.08, 0]);
		kit.box(0.9, 0.26, 0.08, 'body', [-0.1, 0.72, 0]);
	},
	firewall(kit) {
		kit.box(0.46, 0.3, 0.32, 'body', [-0.47, 0.15, 0]);
		kit.box(0.46, 0.3, 0.32, 'accent', [0, 0.15, 0]);
		kit.box(0.46, 0.3, 0.32, 'body', [0.47, 0.15, 0]);
		kit.box(0.46, 0.3, 0.32, 'accent', [-0.24, 0.46, 0]);
		kit.box(0.46, 0.3, 0.32, 'body', [0.24, 0.46, 0]);
		kit.box(0.46, 0.3, 0.32, 'body', [-0.47, 0.77, 0]);
		kit.box(0.46, 0.3, 0.32, 'accent', [0, 0.77, 0]);
		kit.box(0.46, 0.3, 0.32, 'body', [0.47, 0.77, 0]);
	},
	auth(kit) {
		kit.box(1, 0.76, 0.5, 'body', [0, 0.38, 0]);
		kit.add(new THREE.TorusGeometry(0.31, 0.08, 12, kit.detail, Math.PI), 'accent', [0, 0.76, 0]);
		kit.cylinder(0.11, 0.11, 0.05, 'dark', [0, 0.44, 0.26], [Math.PI / 2, 0, 0]);
		kit.box(0.07, 0.2, 0.03, 'dark', [0, 0.28, 0.26]);
	},
	secret(kit) {
		kit.add(new THREE.TorusGeometry(0.28, 0.1, 12, kit.detail), 'accent', [0, 0.95, 0]);
		kit.cylinder(0.07, 0.07, 0.72, 'accent', [0, 0.32, 0]);
		kit.box(0.26, 0.09, 0.09, 'accent', [0.14, 0.14, 0]);
		kit.box(0.2, 0.09, 0.09, 'accent', [0.11, 0.32, 0]);
		pad(kit, 0.4);
	},
	decision(kit) {
		pad(kit, 0.36);
		kit.add(new THREE.OctahedronGeometry(0.58), 'accent', [0, 0.76, 0]);
	},
	actor(kit) {
		pad(kit, 0.46);
		kit.add(new THREE.CapsuleGeometry(0.3, 0.42, 6, 20), 'accent', [0, 0.52, 0]);
		kit.add(new THREE.SphereGeometry(0.24, 24, 18), 'body', [0, 1.14, 0]);
	},
	screen(kit) {
		kit.cylinder(0.32, 0.38, 0.06, 'dark', [0, 0.03, 0]);
		kit.box(0.12, 0.4, 0.1, 'dark', [0, 0.25, -0.05]);
		kit.box(1.32, 0.86, 0.1, 'body', [0, 0.82, 0], [-0.16, 0, 0]);
		kit.box(1.14, 0.68, 0.03, 'accent', [0, 0.82, 0.055], [-0.16, 0, 0]);
	},
	state(kit) {
		kit.add(
			new THREE.CapsuleGeometry(0.34, 0.82, 8, 24),
			'body',
			[0, 0.36, 0],
			[0, 0, Math.PI / 2]
		);
		kit.cylinder(0.08, 0.08, 0.02, 'accent', [0, 0.71, 0]);
	},
	class(kit) {
		kit.box(1.2, 0.26, 0.9, 'accent', [0, 0.75, 0]);
		kit.box(1.2, 0.26, 0.9, 'body', [0, 0.45, 0]);
		kit.box(1.2, 0.26, 0.9, 'body', [0, 0.15, 0]);
	},
	terminal(kit) {
		kit.add(new THREE.SphereGeometry(0.28, 24, 18), 'accent', [0, 0.28, 0]);
		kit.add(
			new THREE.TorusGeometry(0.42, 0.045, 10, kit.detail),
			'dark',
			[0, 0.05, 0],
			[Math.PI / 2, 0, 0]
		);
	}
};

export const SHAPE_SCALE = 1.42;

export function buildNodeShape(
	kind: NodeKind,
	materials: NodeMaterials,
	theme: Theme
): THREE.Group {
	const kit = new Kit(materials, theme);
	BUILDERS[kind](kit);
	return kit.group;
}

export function shapeHeight(kind: NodeKind): number {
	return baseHeight(kind) * SHAPE_SCALE;
}

function baseHeight(kind: NodeKind): number {
	switch (kind) {
		case 'internet':
		case 'loadbalancer':
		case 'dns':
		case 'actor':
		case 'gateway':
		case 'secret':
		case 'decision':
			return 1.5;
		case 'database':
		case 'screen':
		case 'class':
		case 'storage':
			return 1.25;
		case 'state':
		case 'terminal':
			return 0.8;
		default:
			return 1.1;
	}
}
