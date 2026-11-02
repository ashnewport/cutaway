import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, detectFormat, ParseError, parseDiagram, renderSvg } from '../src/core/index.ts';

const EXAMPLES = join(import.meta.dirname, '../src/examples');
const exampleFiles = readdirSync(EXAMPLES).filter((name) => !name.endsWith('.ts'));
const read = (name: string) => readFileSync(join(EXAMPLES, name), 'utf8');

describe('format detection', () => {
	it.each([
		['flowchart LR\nA-->B', 'mermaid-flowchart'],
		['graph TD;\nA-->B', 'mermaid-flowchart'],
		['---\ntitle: x\n---\nsequenceDiagram\nA->>B: hi', 'mermaid-sequence'],
		['%% comment\nstateDiagram-v2\n[*] --> A', 'mermaid-state'],
		['classDiagram\nA --> B', 'mermaid-class'],
		['@startuml\nA -> B\n@enduml', 'plantuml'],
		['digraph G { a -> b }', 'dot'],
		['graph G { a -- b }', 'dot'],
		['{"layers":[]}', 'json']
	])('detects %s', (source, format) => {
		expect(detectFormat(source)).toBe(format);
	});

	it('returns null for prose', () => {
		expect(detectFormat('hello there')).toBeNull();
	});
});

describe('mermaid flowchart', () => {
	it('reads every arrow form', () => {
		const diagram = parseDiagram(`flowchart LR
			A --> B
			B --- C
			C -.-> D
			D ==> E
			E -->|piped| F
			F -- inline --> G
			G -. dotted .-> H
			H == heavy ==> I
			I --x J
			J <--> K
			K--tight-->L`);
		const labels = diagram.edges.map((edge) => edge.label);
		expect(labels).toEqual(['', '', '', '', 'piped', 'inline', 'dotted', 'heavy', '', '', 'tight']);
		const styles = diagram.edges.map((edge) => edge.style);
		expect(styles).toEqual([
			'solid',
			'solid',
			'dashed',
			'thick',
			'solid',
			'solid',
			'dashed',
			'thick',
			'solid',
			'solid',
			'solid'
		]);
		expect(diagram.edges[1].directed).toBe(false);
		expect(diagram.edges[8].payload).toBe('error');
	});

	it('reads node shapes and quoted labels with brackets inside', () => {
		const diagram = parseDiagram(`flowchart TD
			a[Plain] --> b(Round)
			b --> c([Stadium])
			c --> d[(Rows)]
			d --> e((Circle))
			e --> f{Choose}
			f --> g{{Hex}}
			g --> h[/Slant/]
			h --> i["Has [brackets] inside"]
			i --> j[[Sub]]`);
		const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
		expect(byId.get('d')?.kind).toBe('database');
		expect(byId.get('f')?.kind).toBe('decision');
		expect(byId.get('h')?.kind).toBe('screen');
		expect(byId.get('j')?.kind).toBe('function');
		expect(byId.get('i')?.label).toBe('Has [brackets] inside');
	});

	it('expands chains and fan-outs, keeping a fan-out as one parallel step', () => {
		const diagram = parseDiagram('flowchart LR\nA --> B --> C\nC & D --> E & F');
		expect(diagram.edges).toHaveLength(6);
		expect(diagram.steps).toHaveLength(3);
		expect(diagram.steps[2].edges).toHaveLength(4);
	});

	it('turns top-level subgraphs into plates and nested ones into zones', () => {
		const diagram = parseDiagram(`flowchart LR
			subgraph a[Top]
				x
			end
			subgraph b[Bottom]
				subgraph c[Inner]
					subgraph d[Innermost]
						y
					end
				end
			end
			x --> y`);
		expect(diagram.layers.map((layer) => layer.title)).toEqual(['Top', 'Bottom']);
		expect(diagram.zones.map((zone) => [zone.id, zone.layer, zone.parent])).toEqual([
			['c', 'b', null],
			['d', 'b', 'c']
		]);
		expect(diagram.nodes.find((node) => node.id === 'y')?.zone).toBe('d');
	});

	it('keeps a node on the plate that declares it, not the one that first mentions it', () => {
		const diagram = parseDiagram(`flowchart LR
			subgraph a
				x --> y
			end
			subgraph b
				y[Declared here]
			end`);
		expect(diagram.nodes.find((node) => node.id === 'y')?.layer).toBe('b');
	});

	it('groups edges under @step and applies directives', () => {
		const diagram = parseDiagram(`flowchart LR
			%% @title Directive title
			%% @kind a loadbalancer
			%% @detail a Listens on 443
			%% @step Both at once
			a --> b
			a --> c
			%% @step Alone
			c --> d`);
		expect(diagram.title).toBe('Directive title');
		expect(diagram.steps.map((step) => step.caption)).toEqual(['Both at once', 'Alone']);
		expect(diagram.steps[0].edges).toHaveLength(2);
		const a = diagram.nodes.find((node) => node.id === 'a');
		expect(a?.kind).toBe('loadbalancer');
		expect(a?.detail).toBe('Listens on 443');
	});

	it('reports the line of a real syntax error', () => {
		expect.assertions(2);
		try {
			parseDiagram('flowchart LR\nA --> B\nC[Unclosed --> D');
		} catch (error) {
			expect(error).toBeInstanceOf(ParseError);
			expect((error as ParseError).line).toBe(3);
		}
	});

	it('survives edges that point at a subgraph id without crashing layout', () => {
		const { scene } = compile('flowchart LR\nsubgraph s[Group]\nA\nend\nB --> s\nA --> B');
		expect(scene.nodes.length).toBeGreaterThan(0);
	});
});

describe('mermaid sequence', () => {
	const source = `sequenceDiagram
		box Top
			actor U as User
			participant B as Browser
		end
		box Bottom
			participant D as Database
		end
		%% @zone net "Network": D
		U->>B: click
		Note over U,B: Explains the click
		B->>+D: read
		D-->>-B: rows
		alt bad token
			B-xU: 401 denied
		end
		par fan
			B->>D: one
		and
			B->>U: two
		end`;

	it('maps boxes to plates and notes to captions', () => {
		const diagram = parseDiagram(source);
		expect(diagram.layers.map((layer) => layer.title)).toEqual(['Top', 'Bottom']);
		expect(diagram.nodes.find((node) => node.id === 'U')?.kind).toBe('actor');
		expect(diagram.steps[0].caption).toBe('Explains the click');
		expect(diagram.edges[2].style).toBe('dashed');
		expect(diagram.edges[3].payload).toBe('error');
		expect(diagram.steps[3].caption).toContain('bad token');
	});

	it('plays a par block as one step', () => {
		const diagram = parseDiagram(source);
		expect(diagram.steps).toHaveLength(5);
		expect(diagram.steps[4].edges).toHaveLength(2);
	});

	it('hangs @zone regions under the box they belong to', () => {
		const diagram = parseDiagram(source);
		expect(diagram.zones).toEqual([{ id: 'net', title: 'Network', layer: 'bottom', parent: null }]);
		expect(diagram.nodes.find((node) => node.id === 'D')?.zone).toBe('net');
	});
});

describe('other formats', () => {
	it('reads state diagrams, including composites and start and end', () => {
		const diagram = parseDiagram(read('order-state.mmd'));
		expect(diagram.layers.map((layer) => layer.title)).toContain('Fulfilment');
		expect(diagram.nodes.find((node) => node.id === 'root__start')?.kind).toBe('terminal');
		expect(
			diagram.edges.find((edge) => edge.from === 'Submitted' && edge.to === 'Failed')?.payload
		).toBe('error');
	});

	it('reads class diagrams and points inheritance at the base', () => {
		const diagram = parseDiagram(
			'classDiagram\nAnimal <|-- Duck\nclass Duck {\n+quack()\n}\nAnimal : +int age'
		);
		expect(diagram.edges[0]).toMatchObject({ from: 'Duck', to: 'Animal' });
		expect(diagram.nodes.find((node) => node.id === 'Duck')?.detail).toBe('1 member');
	});

	it('reads PlantUML sequences, boxes, notes and reversed arrows', () => {
		const diagram = parseDiagram(`@startuml
			title Hello
			box "One"
				actor A
			end box
			box "Two"
				database "Rows" as B
			end box
			A -> B : ask
			note right : Asking nicely.
			A <-- B : reply
			@enduml`);
		expect(diagram.title).toBe('Hello');
		expect(diagram.layers).toHaveLength(2);
		expect(diagram.nodes.find((node) => node.id === 'B')?.kind).toBe('database');
		expect(diagram.steps[0].caption).toBe('Asking nicely.');
		expect(diagram.edges[1]).toMatchObject({ from: 'B', to: 'A', style: 'dashed' });
	});

	it('reads PlantUML component diagrams', () => {
		const diagram = parseDiagram(`@startuml
			package "Front" {
				[Web]
			}
			node "Back" {
				[Api] as api
				database "Store" as db
			}
			[Web] --> api : calls
			api --> db
			@enduml`);
		expect(diagram.layers.map((layer) => layer.title)).toEqual(['Front', 'Back']);
		expect(diagram.edges).toHaveLength(2);
		expect(diagram.edges[0].from).toBe('Web');
	});

	it('reads DOT clusters, attributes, chains and step directives', () => {
		const diagram = parseDiagram(`digraph G {
			subgraph cluster_a { label="Alpha"; x [label="Ex"]; }
			// @step Chain
			x -> y -> z [label="go", style=dashed];
		}`);
		expect(diagram.title).toBe('G');
		expect(diagram.layers[0].title).toBe('Alpha');
		expect(diagram.steps).toHaveLength(1);
		expect(diagram.steps[0].caption).toBe('Chain');
		expect(diagram.edges).toHaveLength(2);
		expect(diagram.edges[0].style).toBe('dashed');
	});

	it('reads native JSON and rejects dangling links', () => {
		const good = parseDiagram(
			JSON.stringify({
				title: 'J',
				layers: [{ title: 'L', nodes: [{ id: 'a' }, { id: 'b', kind: 'database' }] }],
				steps: [{ caption: 'c', edges: [{ from: 'a', to: 'b', label: 'x' }] }]
			})
		);
		expect(good.steps[0].title).toBe('x');
		expect(() =>
			parseDiagram(
				JSON.stringify({
					layers: [{ nodes: [{ id: 'a' }] }],
					steps: [{ edges: [{ from: 'a', to: 'z' }] }]
				})
			)
		).toThrow(ParseError);
	});
});

describe('kind inference', () => {
	it.each([
		['Internet gateway', 'gateway'],
		['Public internet', 'internet'],
		['Application load balancer', 'loadbalancer'],
		['Redis session store', 'cache'],
		['User directory DB', 'database'],
		['S3 receipts bucket', 'storage'],
		['Developer', 'actor'],
		['Login page', 'screen'],
		['Cognito identity provider', 'auth'],
		['JWKS signing keys', 'secret']
	])('draws %s as %s', (label, kind) => {
		const diagram = parseDiagram(`flowchart LR\n%% @autolayer off\nn["${label}"]`);
		expect(diagram.nodes[0].kind).toBe(kind);
	});
});

describe('auto layers', () => {
	it('sorts a flat diagram by inferred type and says so', () => {
		const diagram = parseDiagram('flowchart LR\nu[User] --> api[Orders API] --> db[(Postgres)]');
		expect(diagram.layers.map((layer) => layer.id)).toEqual(['ui', 'app', 'infra']);
		expect(diagram.warnings.some((warning) => warning.message.includes('inferred'))).toBe(true);
	});

	it('honours @autolayer off', () => {
		const diagram = parseDiagram('flowchart LR\n%% @autolayer off\nu[User] --> db[(Postgres)]');
		expect(diagram.layers).toHaveLength(1);
	});
});

describe('compiled examples', () => {
	it.each(exampleFiles)('%s produces a coherent scene with no parser warnings', (name) => {
		const { scene, script } = compile(read(name));
		const { diagram } = scene;
		expect(diagram.warnings).toEqual([]);
		expect(diagram.title).not.toBe('Untitled diagram');
		expect(script.steps.length).toBeGreaterThan(3);
		expect(script.steps.length).toBe(diagram.steps.length);

		for (const edge of diagram.edges) {
			expect(scene.routes.some((route) => route.id === scene.edgeRoute[edge.id])).toBe(true);
		}
		for (const route of scene.routes) {
			expect(route.length).toBeGreaterThan(0);
			for (const point of route.points)
				for (const value of point) expect(Number.isFinite(value)).toBe(true);
		}

		// Time must only move forward, or GSAP and the audio cues would disagree.
		let previous = 0;
		for (const step of script.steps) {
			expect(step.start).toBeGreaterThanOrEqual(previous);
			expect(step.end).toBeGreaterThan(step.start);
			previous = step.end;
		}
		expect(script.duration).toBeGreaterThan(previous);
	});

	it.each(exampleFiles)('%s keeps nodes on the plate and sibling zones apart', (name) => {
		const { scene } = compile(read(name));
		for (const node of scene.nodes) {
			const { rect } = scene.layers[node.layerIndex];
			expect(node.position[0]).toBeGreaterThan(rect.x);
			expect(node.position[0]).toBeLessThan(rect.x + rect.width);
			expect(node.position[2]).toBeGreaterThan(rect.z);
			expect(node.position[2]).toBeLessThan(rect.z + rect.depth);
		}
		for (const a of scene.zones) {
			for (const b of scene.zones) {
				if (a.id >= b.id || a.layerIndex !== b.layerIndex || a.parent !== b.parent) continue;
				const apart =
					a.rect.x + a.rect.width <= b.rect.x ||
					b.rect.x + b.rect.width <= a.rect.x ||
					a.rect.z + a.rect.depth <= b.rect.z ||
					b.rect.z + b.rect.depth <= a.rect.z;
				expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
			}
		}
	});

	it('is deterministic, which frame-by-frame export relies on', () => {
		const a = compile(read('oidc.mmd'));
		const b = compile(read('oidc.mmd'));
		expect(JSON.stringify(a.script)).toBe(JSON.stringify(b.script));
	});

	it('shares one route between repeated messages and marks plate crossings', () => {
		const { scene } = compile(read('oidc.mmd'));
		const repeated = scene.diagram.edges.filter(
			(edge) => edge.from === 'BFF' && edge.to === 'Sessions'
		);
		expect(repeated.length).toBeGreaterThan(1);
		expect(new Set(repeated.map((edge) => scene.edgeRoute[edge.id])).size).toBe(1);
		const cross = scene.routes.find((route) => route.id === 'Browser=>Net');
		expect(cross?.kind).toBe('cross');
		expect(cross?.crossings.length).toBeGreaterThan(0);
	});

	it('hidden layers drop their steps from the timeline', () => {
		const source = read('three-tier.mmd');
		const all = compile(source).script;
		const some = compile(source, { hiddenLayers: [2] }).script;
		expect(some.steps.length).toBeLessThan(all.steps.length);
		expect(some.duration).toBeLessThan(all.duration);
	});
});

describe('svg renderer', () => {
	it('escapes user text so a diagram cannot inject markup', () => {
		const { scene } = compile(
			'flowchart LR\nsubgraph x["<script>alert(1)</script>"]\na["<img src=x onerror=y>"] --> b\nend'
		);
		const svg = renderSvg(scene);
		expect(svg).not.toContain('<script>');
		expect(svg).not.toContain('<img');
	});

	it('draws every plate and node', () => {
		const { scene } = compile(read('three-tier.mmd'));
		const svg = renderSvg(scene);
		expect(svg.startsWith('<svg')).toBe(true);
		for (const node of scene.nodes) expect(svg).toContain(node.label);
		for (const layer of scene.layers) expect(svg).toContain(layer.title);
	});
});

describe('isomorphic core', () => {
	it('runs from the command line under plain Node, with no DOM', () => {
		const dir = mkdtempSync(join(tmpdir(), 'cutaway-'));
		const svgPath = join(dir, 'out.svg');
		const jsonPath = join(dir, 'out.json');
		const output = execFileSync(
			process.execPath,
			['bin/cutaway.ts', 'src/examples/oidc.mmd', '--svg', svgPath, '--json', jsonPath],
			{ cwd: join(import.meta.dirname, '..'), encoding: 'utf8' }
		);
		expect(output).toContain('OIDC sign-in');
		expect(readFileSync(svgPath, 'utf8').startsWith('<svg')).toBe(true);
		const { script } = JSON.parse(readFileSync(jsonPath, 'utf8'));
		const fresh = compile(read('oidc.mmd')).script;
		expect(script.duration).toBeCloseTo(fresh.duration);
	});

	it('exits non-zero with the line number on a bad diagram', () => {
		const dir = mkdtempSync(join(tmpdir(), 'cutaway-'));
		const bad = join(dir, 'bad.mmd');
		writeFileSync(bad, 'flowchart LR\nA[Unclosed --> B');
		const run = spawnSync(process.execPath, ['bin/cutaway.ts', bad], {
			cwd: join(import.meta.dirname, '..'),
			encoding: 'utf8'
		});
		expect(run.status).toBe(1);
		expect(run.stderr).toContain(':2:');
	});
});

describe('edge cases that must not crash the player', () => {
	it('handles nodes with no links, giving an empty but valid timeline', () => {
		const { script } = compile('flowchart LR\nA[Only]\nB[Nodes]');
		expect(script.steps).toEqual([]);
		expect(script.duration).toBeGreaterThan(0);
	});

	it('handles a self-loop', () => {
		const { scene, script } = compile('sequenceDiagram\nA->>A: thinks');
		expect(scene.routes[0].kind).toBe('self');
		expect(script.steps).toHaveLength(1);
	});

	it('handles hiding every layer that has steps', () => {
		const { script } = compile('flowchart LR\nsubgraph a\nx-->y\nend\nsubgraph b\nz\nend', {
			hiddenLayers: [0]
		});
		expect(script.steps).toEqual([]);
	});

	it('handles labels with quotes and unicode', () => {
		const { scene } = compile('flowchart LR\na["Café 日本語"] -->|"Sends \'x\'"| b');
		expect(scene.nodes[0].label).toBe('Café 日本語');
	});
});
