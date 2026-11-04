import type { Db, Sql } from "./client";

export type JobKind = "process_conversation" | "deliver_event";

export interface Job {
  id: number;
  tenantId: string;
  kind: JobKind;
  refId: string;
  status: "queued" | "running" | "done" | "failed";
  runAt: Date;
  attempts: number;
  maxAttempts: number;
}

/** Tempo máximo que um job pode ficar em execução antes de ser considerado travado. */
export const JOB_LEASE_SECONDS = 120;

/**
 * Agenda (ou adia) o job de uma referência. Se já existe um job aguardando,
 * apenas empurra o horário de execução — é assim que mensagens em sequência
 * são agrupadas em uma única resposta (debounce).
 */
export async function enqueueJob(
  db: Db,
  input: { tenantId: string; kind: JobKind; refId: string; runAt: Date; maxAttempts?: number },
): Promise<Job> {
  const [job] = await db<Job[]>`
    insert into private.jobs (tenant_id, kind, ref_id, run_at, max_attempts)
    values (${input.tenantId}, ${input.kind}, ${input.refId}, ${input.runAt}, ${input.maxAttempts ?? 5})
    on conflict (kind, ref_id) where status = 'queued'
    do update set run_at = greatest(private.jobs.run_at, excluded.run_at)
    returning *`;
  return job!;
}

/**
 * Reivindica um job vencido de forma exclusiva por referência: nunca há dois
 * workers processando a mesma conversa ao mesmo tempo.
 */
export async function claimJob(sql: Sql, jobId: number): Promise<Job | null> {
  return sql.begin(async (tx) => {
    const [candidate] = await tx<{ kind: JobKind; refId: string }[]>`
      select kind, ref_id from private.jobs where id = ${jobId}`;
    if (!candidate) return null;
    await tx`select pg_advisory_xact_lock(hashtextextended(${`${candidate.kind}:${candidate.refId}`}, 0))`;
    const [job] = await tx<Job[]>`
      update private.jobs j set status = 'running', attempts = attempts + 1,
        locked_until = now() + make_interval(secs => ${JOB_LEASE_SECONDS})
      where j.id = ${jobId} and j.status = 'queued' and j.run_at <= now()
        and not exists (
          select 1 from private.jobs r
          where r.kind = j.kind and r.ref_id = j.ref_id and r.status = 'running' and r.locked_until > now()
        )
      returning *`;
    return job ?? null;
  });
}

export async function completeJob(db: Db, jobId: number) {
  await db`update private.jobs set status = 'done', locked_until = null, last_error = null where id = ${jobId}`;
}

/** Devolve para a fila com backoff exponencial ou marca como falho. Retorna true se ainda haverá nova tentativa. */
export async function failJob(db: Db, job: Job, error: string, retryable: boolean): Promise<boolean> {
  const willRetry = retryable && job.attempts < job.maxAttempts;
  if (!willRetry) {
    await db`update private.jobs set status = 'failed', locked_until = null, last_error = ${error} where id = ${job.id}`;
    return false;
  }
  const delaySeconds = Math.min(15 * 2 ** (job.attempts - 1), 900);
  await requeueOrAbsorb(db, job.id, error, delaySeconds);
  return true;
}

/**
 * Volta o job para a fila. Se outra mensagem já criou um job aguardando para a
 * mesma referência (índice único parcial), este é encerrado: o outro cobre o trabalho.
 */
async function requeueOrAbsorb(db: Db, jobId: number, error: string, delaySeconds: number) {
  try {
    await db`
      update private.jobs set status = 'queued', locked_until = null, last_error = ${error},
        run_at = now() + make_interval(secs => ${delaySeconds})
      where id = ${jobId}`;
  } catch (err) {
    if ((err as { code?: string }).code !== "23505") throw err;
    await db`update private.jobs set status = 'done', locked_until = null, last_error = ${`${error} (absorvido)`} where id = ${jobId}`;
  }
}

/** Jobs cujo worker morreu (timeout da função, deploy) voltam para a fila. */
export async function requeueStaleJobs(db: Db): Promise<number> {
  const stale = await db<{ id: number }[]>`
    select id from private.jobs where status = 'running' and locked_until < now() order by id limit 100`;
  for (const { id } of stale) await requeueOrAbsorb(db, id, "lease expirado", 0);
  return stale.length;
}

export async function listDueJobIds(db: Db, limit: number): Promise<number[]> {
  const rows = await db<{ id: number }[]>`
    select id from private.jobs where status = 'queued' and run_at <= now()
    order by run_at limit ${limit}`;
  return rows.map((r) => r.id);
}

export async function nextQueuedJobFor(db: Db, kind: JobKind, refId: string): Promise<{ id: number; runAt: Date } | null> {
  const [row] = await db<{ id: number; runAt: Date }[]>`
    select id, run_at from private.jobs where kind = ${kind} and ref_id = ${refId} and status = 'queued'`;
  return row ?? null;
}
