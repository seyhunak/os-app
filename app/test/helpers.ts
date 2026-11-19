import { DatabaseSync } from 'node:sqlite';
import { Store, type Secrets, type Sql } from '../src/core/db';

/** The store on node:sqlite in memory, the same SQL the phone runs on expo-sqlite. */
export function memorySql(): Sql {
  const db = new DatabaseSync(':memory:');
  return {
    exec: (source) => db.exec(source),
    run: (source, ...params) => {
      const result = db.prepare(source).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    get: (source, ...params) => (db.prepare(source).get(...params) as Record<string, unknown> | undefined) ?? null,
    all: (source, ...params) => db.prepare(source).all(...params) as Record<string, unknown>[],
  };
}

/** Stands in for the Keychain. */
export function memorySecrets(): Secrets & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v), delete: (k) => void map.delete(k) };
}

export const memoryStore = () => new Store(memorySql(), memorySecrets());
