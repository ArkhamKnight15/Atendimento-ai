/**
 * Aplica as migrações SQL no banco apontado por DATABASE_URL.
 *
 *   npm run db:migrate                 # banco Supabase (use a conexão direta, porta 5432)
 *   npm run db:migrate -- --local      # Postgres puro: cria antes os stubs do Supabase (auth, papéis)
 */
import "./load-env";
import { readFile } from "node:fs/promises";
import { applyMigrations } from "../src/server/db/migrate";
import { createSql } from "../src/server/db/client";
import { requireEnv } from "../src/server/env";

const local = process.argv.includes("--local");
const sql = createSql(requireEnv("DATABASE_URL"), { max: 1 });

try {
  if (local) {
    await sql.unsafe(await readFile("supabase/tests/local-bootstrap.sql", "utf8"));
    console.log("✔ stubs locais do Supabase (auth, papéis)");
  }
  const executed = await applyMigrations(sql, "supabase/migrations", console.log);
  console.log(executed.length ? `${executed.length} migração(ões) aplicada(s).` : "Banco já está atualizado.");
} catch (error) {
  console.error("Falha ao migrar:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
