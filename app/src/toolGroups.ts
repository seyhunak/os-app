/** Settings lists tools by category, both A to Z, so a long list stays easy to scan. */
export function groupByCategory<T extends { name: string; category: string }>(tools: T[]): Array<{ category: string; tools: T[] }> {
  const az = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
  const groups = new Map<string, T[]>();
  for (const tool of tools) groups.set(tool.category, [...(groups.get(tool.category) ?? []), tool]);
  return [...groups]
    .sort(([a], [b]) => az(a, b))
    .map(([category, list]) => ({ category, tools: [...list].sort((a, b) => az(a.name, b.name)) }));
}
