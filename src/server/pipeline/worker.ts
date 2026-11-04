import { claimJob, completeJob, failJob, listDueJobIds, nextQueuedJobFor, requeueStaleJobs, type Job } from "../db/jobs";
import type { Deps } from "./deps";
import { deliverEvent } from "./deliver-event";
import { errorMessage, isRetryable } from "./errors";
import { processConversation, processConversationGaveUp } from "./process-conversation";
import type { ScheduledJob } from "./ingest";

export type JobRunResult = "done" | "skipped" | "retry" | "failed";

async function execute(deps: Deps, job: Job) {
  const finalAttempt = job.attempts >= job.maxAttempts;
  if (job.kind === "process_conversation") {
    await processConversation(deps, job.tenantId, job.refId, { finalAttempt });
  } else {
    await deliverEvent(deps, job.refId, { finalAttempt });
  }
}

/** Reivindica e executa um job. `skipped` = não venceu ainda, já foi feito ou a conversa está ocupada. */
export async function runJob(deps: Deps, jobId: number): Promise<JobRunResult> {
  const job = await claimJob(deps.sql, jobId);
  if (!job) return "skipped";
  const log = deps.logger.child({ jobId: job.id, kind: job.kind, attempt: job.attempts });
  try {
    await execute(deps, job);
    await completeJob(deps.sql, job.id);
    return "done";
  } catch (error) {
    const message = errorMessage(error);
    const willRetry = await failJob(deps.sql, job, message, isRetryable(error));
    log[willRetry ? "warn" : "error"](willRetry ? "job falhou; nova tentativa agendada" : "job falhou definitivamente", {
      error: message,
    });
    if (!willRetry && job.kind === "process_conversation") {
      await processConversationGaveUp(deps, job.tenantId, job.refId, message).catch((fallbackError) =>
        log.error("falha ao enviar mensagem de contingência", { error: errorMessage(fallbackError) }),
      );
    }
    return willRetry ? "retry" : "failed";
  }
}

/**
 * Executado após responder o webhook (`after()`): espera o fim da janela de
 * agrupamento e processa. Mensagens que chegarem durante o processamento
 * criam um novo job, drenado aqui mesmo em sequência.
 */
export async function runJobsWhenDue(deps: Deps, jobs: ScheduledJob[]) {
  await Promise.allSettled(jobs.map((job) => runConversationJobs(deps, job)));
}

async function runConversationJobs(deps: Deps, first: ScheduledJob) {
  let next: ScheduledJob | null = first;
  for (let round = 0; next && round < 5; round++) {
    await deps.sleep(next.runAt.getTime() - deps.now().getTime() + 200);
    const result = await runJob(deps, next.id);
    if (result === "skipped" && round > 0) return;

    const [job] = await deps.sql<{ kind: Job["kind"]; refId: string; status: Job["status"] }[]>`
      select kind, ref_id, status from private.jobs where id = ${next.id}`;
    if (!job) return;
    // "skipped" na 1ª rodada pode ser só diferença de relógio com o banco: tenta mais uma vez.
    if (result === "skipped" && job.status === "queued") {
      next = { id: next.id, runAt: new Date(deps.now().getTime() + 1000) };
      continue;
    }
    if (result !== "done") return;
    const queued = await nextQueuedJobFor(deps.sql, job.kind, job.refId);
    // Só drena aqui se a próxima rodada estiver próxima; senão, o cron assume.
    next = queued && queued.runAt.getTime() - deps.now().getTime() < 20_000 ? queued : null;
  }
}

/** Varredura do cron: recupera jobs travados e executa os vencidos dentro do orçamento de tempo. */
export async function runDueJobs(deps: Deps, options: { limit: number; budgetMs: number }) {
  const started = deps.now().getTime();
  const requeued = await requeueStaleJobs(deps.sql);
  const ids = await listDueJobIds(deps.sql, options.limit);
  const summary: Record<JobRunResult, number> = { done: 0, skipped: 0, retry: 0, failed: 0 };
  for (const id of ids) {
    if (deps.now().getTime() - started > options.budgetMs) break;
    summary[await runJob(deps, id)] += 1;
  }
  return { requeued, due: ids.length, ...summary };
}
