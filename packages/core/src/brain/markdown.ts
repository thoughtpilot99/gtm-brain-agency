/** Small helpers for reading structured facts out of brain Markdown files. */

export interface Section {
  heading: string;
  level: number;
  body: string;
}

export function sections(md: string): Section[] {
  const out: Section[] = [];
  let current: Section = { heading: "", level: 0, body: "" };
  for (const line of md.split(/\r?\n/)) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      out.push(current);
      current = { heading: m[2].trim(), level: m[1].length, body: "" };
    } else current.body += line + "\n";
  }
  out.push(current);
  return out.filter((s) => s.heading || s.body.trim());
}

export function section(md: string, name: RegExp): Section | undefined {
  return sections(md).find((s) => name.test(s.heading));
}

/** Bullet items under a heading, with HTML comments and placeholders removed. */
export function bullets(md: string, name: RegExp): string[] {
  const s = section(md, name);
  if (!s) return [];
  return s.body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n/)
    .map((l) => /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(l)?.[1]?.trim())
    .filter((l): l is string => !!l && !isPlaceholder(l));
}

export function isPlaceholder(s: string): boolean {
  return /\[[a-z][^\]]*\]/i.test(s) && !/\]\(/.test(s);
}

/** "key: value" bullets as a map. */
export function keyValues(md: string, name: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of bullets(md, name)) {
    const m = /^([a-z_ ]+):\s*(.+)$/i.exec(b);
    if (m) out[m[1].trim().toLowerCase().replace(/\s+/g, "_")] = m[2].trim();
  }
  return out;
}

export function placeholdersIn(md: string): string[] {
  const found = md.replace(/<!--[\s\S]*?-->/g, "").match(/\[[a-z][^\]\n]{1,40}\](?!\()/gi) ?? [];
  return [...new Set(found)];
}

/** Lines quoted as "> ..." are treated as verbatim buyer words in call notes. */
export function quotes(md: string): string[] {
  return md
    .split(/\r?\n/)
    .map((l) => /^\s*>\s?(.*)$/.exec(l)?.[1]?.trim())
    .filter((l): l is string => !!l && l.length > 8);
}
