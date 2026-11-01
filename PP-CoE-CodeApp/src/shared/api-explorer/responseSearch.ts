export function findResponseMatches(text: string, query: string): Array<{ start: number; end: number }> {
  if (!query) return [];
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return Array.from(text.matchAll(expression), (match) => ({
    start: match.index, end: match.index + match[0].length,
  }));
}
