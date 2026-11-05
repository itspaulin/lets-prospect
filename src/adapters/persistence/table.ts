import type Database from 'better-sqlite3';

const snake = (key: string): string => key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);

type Options<T> = { columns: (keyof T & string)[]; json?: (keyof T & string)[]; bool?: (keyof T & string)[]; key?: keyof T & string };

// Small mapper for the outreach tables: camelCase fields <-> snake_case columns, undefined <-> NULL.
export class Table<T extends object> {
  private readonly key: string;

  constructor(
    private readonly db: Database.Database,
    private readonly name: string,
    private readonly options: Options<T>,
  ) {
    this.key = options.key ?? 'id';
  }

  toRow(entity: T): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const column of this.options.columns) {
      const value = (entity as Record<string, unknown>)[column];
      row[column] =
        value === undefined ? null : this.options.json?.includes(column) ? JSON.stringify(value) : this.options.bool?.includes(column) ? (value ? 1 : 0) : value;
    }
    return row;
  }

  fromRow(row: Record<string, unknown>): T {
    const entity: Record<string, unknown> = {};
    for (const column of this.options.columns) {
      const value = row[snake(column)];
      if (value === null || value === undefined) continue;
      entity[column] = this.options.json?.includes(column) ? JSON.parse(value as string) : this.options.bool?.includes(column) ? value === 1 : value;
    }
    return entity as T;
  }

  insert(entity: T): Database.RunResult {
    const columns = this.options.columns;
    return this.db
      .prepare(`INSERT INTO ${this.name} (${columns.map(snake).join(', ')}) VALUES (${columns.map((column) => `@${column}`).join(', ')})`)
      .run(this.toRow(entity));
  }

  update(entity: T): void {
    const assignments = this.options.columns.filter((column) => column !== this.key).map((column) => `${snake(column)} = @${column}`);
    this.db.prepare(`UPDATE ${this.name} SET ${assignments.join(', ')} WHERE ${snake(this.key)} = @${this.key}`).run(this.toRow(entity));
  }

  one(where: string, ...params: unknown[]): T | null {
    const row = this.db.prepare(`SELECT * FROM ${this.name} WHERE ${where}`).get(...params) as Record<string, unknown> | undefined;
    return row ? this.fromRow(row) : null;
  }

  many(where: string, ...params: unknown[]): T[] {
    return (this.db.prepare(`SELECT * FROM ${this.name} WHERE ${where}`).all(...params) as Record<string, unknown>[]).map((row) => this.fromRow(row));
  }
}
