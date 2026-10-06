const STRIP_SUFFIXES = new Set(["ai", "cli", "app"]);

/** "Foo-Bar AI" -> "foobar". Lowercase, separators removed, trailing "AI"/"CLI"/"app" stripped. */
export function normalizeToolName(name: string): string {
  const parts = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  while (parts.length > 1 && STRIP_SUFFIXES.has(parts.at(-1)!)) parts.pop();
  return parts.join("");
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** 1 for identical strings, 0 for nothing in common (normalized edit distance). */
export function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  return len === 0 ? 1 : 1 - levenshtein(a, b) / len;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "tool"
  );
}
