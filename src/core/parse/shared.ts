export class ParseError extends Error {
	line: number | null;
	constructor(message: string, line: number | null = null) {
		super(message);
		this.name = 'ParseError';
		this.line = line;
	}
}

/** Pulls `title:` out of Mermaid's YAML frontmatter and keeps line numbers honest. */
export function stripFrontmatter(source: string): { body: string; title: string; offset: number } {
	const match = /^\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/.exec(source);
	if (!match) return { body: source, title: '', offset: 0 };
	const title =
		/^title:\s*(.+)$/m
			.exec(match[1])?.[1]
			?.trim()
			.replace(/^["']|["']$/g, '') ?? '';
	return {
		body: source.slice(match[0].length),
		title,
		offset: match[0].split('\n').length - 1
	};
}
