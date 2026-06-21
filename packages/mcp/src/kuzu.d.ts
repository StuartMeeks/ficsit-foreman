/**
 * Minimal ambient type declaration for the `kuzu` package, which ships no types.
 * Covers only the surface Foreman uses. Verified empirically against kuzu 0.6.1.
 */
declare module 'kuzu' {
  export class Database {
    constructor(databasePath?: string, bufferPoolSize?: number);
  }

  export class QueryResult {
    getAll(): Promise<Record<string, unknown>[]>;
    close(): void;
  }

  export class PreparedStatement {}

  export class Connection {
    constructor(database: Database, numThreads?: number);
    query(statement: string): Promise<QueryResult>;
    prepare(statement: string): Promise<PreparedStatement>;
    execute(
      preparedStatement: PreparedStatement,
      params?: Record<string, unknown>,
    ): Promise<QueryResult>;
  }

  const kuzu: {
    Database: typeof Database;
    Connection: typeof Connection;
    QueryResult: typeof QueryResult;
    PreparedStatement: typeof PreparedStatement;
    VERSION: string;
    STORAGE_VERSION: number;
  };
  export default kuzu;
}
