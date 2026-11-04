import type { NextRequest } from "next/server";
import { getEnv } from "@/server/env";
import { safeEqual } from "@/server/lib/crypto";
import { logger } from "@/server/lib/logger";
import { getDeps } from "@/server/pipeline/deps";
import { runDueJobs } from "@/server/pipeline/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Rede de segurança da fila (Vercel Cron, a cada minuto): recupera jobs cujo
 * processamento foi interrompido e executa retentativas agendadas.
 * A Vercel envia `Authorization: Bearer $CRON_SECRET` automaticamente.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${getEnv().CRON_SECRET}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const summary = await runDueJobs(getDeps(), { limit: 25, budgetMs: 45_000 });
    if (summary.due || summary.requeued) logger.info("cron de jobs executado", summary);
    return Response.json(summary);
  } catch (error) {
    logger.error("falha no cron de jobs", { error });
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
