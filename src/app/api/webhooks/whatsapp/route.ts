import { after, type NextRequest } from "next/server";
import { getEnv } from "@/server/env";
import { safeEqual } from "@/server/lib/crypto";
import { logger } from "@/server/lib/logger";
import { getDeps } from "@/server/pipeline/deps";
import { ingestWebhook } from "@/server/pipeline/ingest";
import { runJobsWhenDue } from "@/server/pipeline/worker";
import { verifyMetaSignature } from "@/server/whatsapp/signature";
import { parseWebhook } from "@/server/whatsapp/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Verificação do endpoint feita pela Meta ao configurar o webhook. */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge");
  if (params.get("hub.mode") === "subscribe" && challenge && safeEqual(token, getEnv().WHATSAPP_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const env = getEnv();
  const raw = Buffer.from(await request.arrayBuffer());

  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET)) {
    logger.warn("webhook com assinatura inválida rejeitado");
    return new Response("Invalid signature", { status: 401 });
  }

  let parsed;
  try {
    parsed = parseWebhook(JSON.parse(raw.toString("utf8")));
  } catch (error) {
    // Payload autêntico mas fora do formato esperado: confirma para evitar reentregas infinitas.
    logger.warn("webhook ignorado (formato inesperado)", { error });
    return new Response("Ignored", { status: 200 });
  }

  const deps = getDeps();
  try {
    const result = await ingestWebhook(deps, parsed);
    if (result.jobs.length) after(() => runJobsWhenDue(deps, result.jobs));
    logger.debug("webhook processado", { ...result, jobs: result.jobs.length });
  } catch (error) {
    // Falha ao persistir (ex.: banco indisponível): 500 faz a Meta reenviar depois.
    logger.error("falha ao registrar webhook", { error });
    return new Response("Temporary failure", { status: 500 });
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
}
