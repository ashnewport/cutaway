import { layerColor, themeById, type Theme } from './themes.ts';
import type { PlacedNode, Scene, Vec3 } from './types.ts';

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
const SCALE = 26;

function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function project([x, y, z]: Vec3): [number, number] {
	return [(x - z) * COS30 * SCALE, ((x + z) * SIN30 - y) * SCALE];
}

function polygon(points: Vec3[], attrs: string): string {
	const path = points
		.map((point) =>
			project(point)
				.map((value) => value.toFixed(1))
				.join(',')
		)
		.join(' ');
	return `<polygon points="${path}" ${attrs}/>`;
}

/** Draws the stack as a true isometric drawing. Needs no DOM, GPU or browser. */
export function renderSvg(scene: Scene, theme: Theme = themeById('survey')): string {
	const parts: string[] = [];
	const font = `font-family="Archivo, Helvetica, Arial, sans-serif"`;
	const ink = theme.ink;

	// Painter's order: deepest plate first, so upper plates sit visually on top.
	for (const layer of [...scene.layers].reverse()) {
		const { x, z, width, depth } = layer.rect;
		const y = layer.y;
		const color = layerColor(theme, layer.index);
		const thick = scene.plateThickness;
		const corners: Vec3[] = [
			[x, y, z],
			[x + width, y, z],
			[x + width, y, z + depth],
			[x, y, z + depth]
		];
		const under = corners.map(([a, b, c]): Vec3 => [a, b - thick, c]);
		parts.push(
			polygon([corners[3], corners[2], under[2], under[3]], `fill="${color}" fill-opacity=".85"`),
			polygon([corners[1], corners[2], under[2], under[1]], `fill="${color}" fill-opacity=".7"`),
			polygon(
				corners,
				`fill="${color}" fill-opacity="${theme.plateOpacity}" stroke="${ink}" stroke-opacity=".4"`
			)
		);
		const [titleX, titleY] = project([x + 0.5, y, z + depth - 0.4]);
		parts.push(
			`<text x="${titleX.toFixed(1)}" y="${titleY.toFixed(1)}" fill="${ink}" font-size="15" font-weight="700" ${font} transform="rotate(30 ${titleX.toFixed(1)} ${titleY.toFixed(1)}) skewX(-30)">${escapeXml(layer.title)}</text>`
		);

		for (const zone of scene.zones.filter((candidate) => candidate.layerIndex === layer.index)) {
			const lift = y + 0.02 + zone.depth * 0.07;
			const r = zone.rect;
			parts.push(
				polygon(
					[
						[r.x, lift, r.z],
						[r.x + r.width, lift, r.z],
						[r.x + r.width, lift, r.z + r.depth],
						[r.x, lift, r.z + r.depth]
					],
					`fill="${theme.skyTop}" fill-opacity=".28" stroke="${ink}" stroke-opacity=".55" stroke-dasharray="5 4"`
				)
			);
			const [zoneX, zoneY] = project([r.x + 0.25, lift, r.z + 0.55]);
			parts.push(
				`<text x="${zoneX.toFixed(1)}" y="${zoneY.toFixed(1)}" fill="${ink}" font-size="10" ${font}>${escapeXml(zone.title)}</text>`
			);
		}

		for (const route of scene.routes) {
			if (route.layers[0] !== layer.index || route.kind === 'cross') continue;
			parts.push(routePath(route.points, ink, route.style));
		}

		const nodes = scene.nodes.filter((node) => node.layerIndex === layer.index);
		nodes.sort((a, b) => a.position[0] + a.position[2] - (b.position[0] + b.position[2]));
		for (const node of nodes) parts.push(isoNode(node, color, ink, font));
	}

	// Cross-layer routes go last, because they pass in front of the plates they link.
	for (const route of scene.routes) {
		if (route.kind === 'cross') parts.push(routePath(route.points, theme.packet, route.style));
	}

	const box = measure(scene);
	const title = `<title>${escapeXml(scene.diagram.title)}</title>`;
	const background = `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${theme.skyTop}"/>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" role="img">${title}${background}${parts.join('')}</svg>`;
}

function routePath(points: Vec3[], color: string, style: string): string {
	const path = points
		.map((point, index) => {
			const [x, y] = project(point);
			return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
		})
		.join(' ');
	const width = style === 'thick' ? 2.6 : 1.4;
	const dash = style === 'dashed' ? ' stroke-dasharray="5 4"' : '';
	return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity=".8"${dash}/>`;
}

function isoNode(node: PlacedNode, color: string, ink: string, font: string): string {
	const [x, y, z] = node.position;
	const half = 0.6;
	const h = node.height * 0.7;
	const top: Vec3[] = [
		[x - half, y + h, z - half],
		[x + half, y + h, z - half],
		[x + half, y + h, z + half],
		[x - half, y + h, z + half]
	];
	const left: Vec3[] = [top[3], top[2], [x + half, y, z + half], [x - half, y, z + half]];
	const right: Vec3[] = [top[1], top[2], [x + half, y, z + half], [x + half, y, z - half]];
	const stroke = `stroke="${ink}" stroke-width=".8"`;
	const [labelX, labelY] = project([x, y + h + 0.35, z]);
	return [
		polygon(left, `fill="${color}" ${stroke}`),
		polygon(right, `fill="${color}" fill-opacity=".75" ${stroke}`),
		polygon(top, `fill="#fff" fill-opacity=".92" ${stroke}`),
		`<text x="${labelX.toFixed(1)}" y="${(labelY - half * SCALE * SIN30).toFixed(1)}" fill="${ink}" font-size="11.5" font-weight="600" text-anchor="middle" ${font}>${escapeXml(node.label)}</text>`
	].join('');
}

function measure(scene: Scene): { x: number; y: number; width: number; height: number } {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const layer of scene.layers) {
		const { x, z, width, depth } = layer.rect;
		const corners: Vec3[] = [
			[x, layer.y, z],
			[x + width, layer.y, z],
			[x + width, layer.y - scene.plateThickness, z + depth],
			[x, layer.y - scene.plateThickness, z + depth]
		];
		for (const corner of corners) {
			const [px, py] = project(corner);
			minX = Math.min(minX, px);
			maxX = Math.max(maxX, px);
			minY = Math.min(minY, py);
			maxY = Math.max(maxY, py);
		}
	}
	const pad = 60;
	return {
		x: Math.round(minX - pad),
		y: Math.round(minY - pad),
		width: Math.round(maxX - minX + pad * 2),
		height: Math.round(maxY - minY + pad * 2)
	};
}
