# Cutaway

Cutaway turns a diagram into an animated, layered 3D walkthrough. Each group in the source becomes a plate in a stack, and every arrow becomes a packet you can watch travel across a plate or fall through to the next one.

It was built to show one system at several depths at once: what the user sees, how the app moves data, and what the infrastructure does underneath.

## Run it

```bash
git clone https://github.com/ashnewport/cutaway.git
cd cutaway
pnpm install
pnpm dev
```

| Command                                  | What it does                                             |
| ---------------------------------------- | -------------------------------------------------------- |
| `pnpm dev`                               | Starts the app with hot reload                           |
| `pnpm build`                             | Builds a static site into `dist`                         |
| `pnpm test`                              | Runs parser, layout and command line tests               |
| `pnpm test:e2e`                          | Runs browser tests in system Chrome                      |
| `pnpm check`                             | Type checks the project                                  |
| `pnpm cutaway diagram.mmd --svg out.svg` | Compiles a diagram in Node, with no browser              |
| `pnpm gh-pages`                          | Tests, builds and pushes `dist` to the `gh-pages` branch |

## Input formats

| Format            | Becomes a plate                   | Becomes a region       |
| ----------------- | --------------------------------- | ---------------------- |
| Mermaid flowchart | Top-level `subgraph`              | Nested `subgraph`      |
| Mermaid sequence  | `box`                             | `%% @zone` directive   |
| Mermaid state     | Top-level composite state         | Nested composite state |
| Mermaid class     | `namespace`                       | None                   |
| PlantUML          | `box`, `package`, `node`, `cloud` | Nested group           |
| Graphviz DOT      | `subgraph cluster_x`              | Nested cluster         |
| Cutaway JSON      | `layers[]`                        | `layers[].zones[]`     |

The parsers are hand-written, cover common syntax, and report anything they skip as a warning in the source panel. They are not complete implementations of each grammar. Rendering is not delegated to Mermaid.

A diagram with no groups is sorted into UI, application and infrastructure plates by inferred node type, and the source panel says so.

## Directives

Directives live in comments, so the source still renders in other Mermaid, PlantUML or Graphviz tools. Use `%%` in Mermaid, `'` in PlantUML and `//` in DOT.

```text
%% @title Checkout, end to end
%% @step Caption for the arrows that follow, which play together
%% @kind alb loadbalancer
%% @detail alb HTTPS on 443
%% @zone vpc "VPC": alb, api
%% @zone public in vpc "Public subnet": alb
%% @autolayer off
%% @layers off
```

In a sequence diagram, a `Note` becomes the caption of the message before it.

Node kinds are `actor`, `screen`, `service`, `function`, `database`, `storage`, `cache`, `queue`, `gateway`, `loadbalancer`, `internet`, `cdn`, `dns`, `firewall`, `auth`, `secret`, `decision`, `state`, `class` and `terminal`. Names like ALB, Redis, S3 or Cognito are recognised automatically.

Packets change shape by what they carry. Labels that mention tokens, cookies or keys travel as gems, labels that mention failures travel as red pyramids, and everything else travels as a cube.

## Controls

| Input          | Action                |
| -------------- | --------------------- |
| Space          | Play or pause         |
| Left, right    | Previous or next step |
| Up, down       | Pan between layers    |
| Plus, minus    | Zoom                  |
| 0              | Reset camera          |
| M              | Mute                  |
| I              | Isometric view        |
| F              | Full screen           |
| E              | Diagram source        |
| Drag           | Orbit                 |
| Shift and drag | Pan                   |
| Double-click   | Reset camera          |

Browsers block sound until the first click or key press, so the opening animation plays silently until then.

## Export

| Format    | Notes                                                                |
| --------- | -------------------------------------------------------------------- |
| MP4, WebM | Rendered frame by frame with WebCodecs, with the soundtrack included |
| GIF       | Uses one palette for the whole clip, so colours do not flicker       |
| PNG       | The current frame                                                    |
| SVG       | A true isometric drawing, which needs no GPU                         |

Video and GIF exports seek the timeline instead of recording the screen, so a slow machine cannot drop frames. Live panels are not included, and captions are drawn into the frame instead.

## How it fits together

```text
src/core    Parsers, layout, timing plan, SVG renderer, themes. No DOM. Runs in Node and the browser.
src/stage   Three.js scene, GSAP timeline, Web Audio synth, exporters. Browser only.
src/ui      Svelte 5 interface.
bin         Command line wrapper around src/core.
```

The pipeline is one direction: source text, then a `Diagram`, then a positioned `Scene`, then a timed `Script`. All of it is pure and deterministic. The stage turns the script into a single paused GSAP timeline of `fromTo` tweens, which write to a plain state object that the renderer only reads. That is why scrubbing works in any direction, and why exported frames match playback.

Sound is synthesised rather than sampled. One function plays each cue on a live `AudioContext` or an `OfflineAudioContext`, so exported audio matches what you hear. Upper layers sit in a higher register than lower ones.

If WebGL is unavailable, the app falls back to the SVG drawing.

## Themes

The app ships with Survey map, Mine shaft, Blueprint and Arcade. Every colour, material setting, typeface and sound pack can be changed in the Theme menu, and a theme can be copied and pasted as JSON. The choice is saved in the browser.

## Known limits

- Layout runs per plate, so nodes linked across plates are not lined up vertically.
- Very wide diagrams give every plate a large footprint, because all plates share one size.
- Exports are written to memory, so long 1080p or 60 fps clips can use a lot of it.
- Burned-in captions are always in English layout order and do not handle right-to-left text.

## Publish

`pnpm gh-pages` runs the tests, builds the site and pushes `dist` to the `gh-pages` branch on `origin`. Add `--no-push` to stop after the local commit. It refuses to run with uncommitted changes, so every publish matches a commit, and it never force pushes.

In the repository's Pages settings, choose **Deploy from a branch**, then `gh-pages` and `/ (root)`.
