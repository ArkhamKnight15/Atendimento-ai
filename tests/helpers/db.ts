import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { createSql, type Sql } from "../../src/server/db/client";
import { applyMigrations } from "../../src/server/db/migrate";

/**
 * Banco de integração: recriado do zero a cada execução da suíte, com os
 * stubs do Supabase e todas as migrações reais aplicadas.
 * Defina TEST_DATABASE_URL apontando para um Postgres descartável.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export async function createTestDatabase(): Promise<Sql> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL não definido");
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(dbName) || !dbName.includes("test")) {
    throw new Error("Por segurança, o nome do banco de testes precisa conter 'test'.");
  }

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await admin.unsafe(`create database ${dbName}`);
  await admin.end();

  const sql = createSql(TEST_DATABASE_URL, { max: 8 });
  await sql.unsafe(await readFile("supabase/tests/local-bootstrap.sql", "utf8"));
  await applyMigrations(sql, "supabase/migrations");
  return sql;
}
