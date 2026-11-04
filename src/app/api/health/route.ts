import { getEnv } from "@/server/env";
import { getSql } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificação de saúde para monitoramento externo (não expõe detalhes internos). */
export async function GET() {
  try {
    const sql = getSql(getEnv().DATABASE_URL);
    await Promise.race([
      sql`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
    return Response.json({ status: "ok", database: "ok", time: new Date().toISOString() });
  } catch {
    return Response.json({ status: "degraded", database: "unavailable" }, { status: 503 });
  }
}
