import type { Connection } from 'kuzu';

/**
 * Runs a parameterised read query and returns plain rows. Always uses a
 * prepared statement so caller-supplied values can never be interpolated into
 * Cypher text (injection-safe).
 */
export async function rows(
  conn: Connection,
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const statement = await conn.prepare(cypher);
  const result = await conn.execute(statement, params);
  const all = await result.getAll();
  result.close();
  return all;
}
