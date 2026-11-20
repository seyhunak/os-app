import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TOOLKITS } from '../src/core/collectors';
import { groupByCategory } from '../src/toolGroups';

describe('grouping tools in Settings', () => {
  it('lists categories A to Z, and the tools in each A to Z', () => {
    const groups = groupByCategory(TOOLKITS);
    const az = (list: string[]) => [...list].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    assert.deepEqual(groups.map((g) => g.category), ['Calendar', 'Chat', 'Code', 'CRM', 'Email', 'Files and docs', 'News', 'Tasks']);
    for (const g of groups) assert.deepEqual(g.tools.map((t) => t.name), az(g.tools.map((t) => t.name)), g.category);
    assert.equal(groups.flatMap((g) => g.tools).length, TOOLKITS.length);
  });

  it('sorts regardless of case', () => {
    const groups = groupByCategory([{ name: 'zoom', category: 'b' }, { name: 'Asana', category: 'B' }, { name: 'Gmail', category: 'a' }]);
    assert.deepEqual(groups.map((g) => [g.category, g.tools.map((t) => t.name)]), [['a', ['Gmail']], ['b', ['zoom']], ['B', ['Asana']]]);
  });
});
