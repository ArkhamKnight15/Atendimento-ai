import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Sql } from "./client";

/**
 * Aplica as migrações de `supabase/migrations` em ordem, registrando-as na
 * mesma tabela usada pelo Supabase CLI (`supabase_migrations.schema_migrations`).
 * Assim é possível alternar entre `npm run db:migrate` e `supabase db push`.
 */
export async function applyMigrations(sql: Sql, migrationsDir: string, log: (line: string) => void = () => {}) {
  await sql`create schema if not exists supabase_migrations`;
  await sql`
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    )`;

  const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/.test(file)).toSorted();
  const applied = new Set(
    (await sql<{ version: string }[]>`select version from supabase_migrations.schema_migrations`).map((r) => r.version),
  );

  const executed: string[] = [];
  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    if (!version || applied.has(version)) continue;
    const content = await readFile(path.join(migrationsDir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`
        insert into supabase_migrations.schema_migrations (version, statements, name)
        values (${version}, ${[content]}, ${rest.join("_")})`;
    });
    executed.push(file);
    log(`✔ ${file}`);
  }
  return executed;
}
