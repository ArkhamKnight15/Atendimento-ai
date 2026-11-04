import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
/** Qualquer executor de SQL: conexão do pool ou transação aberta. */
export type Db = Sql | Tx;

/**
 * Conexão para uso em ambiente serverless (Vercel) via pooler do Supabase
 * em modo transação (porta 6543): `prepare: false` é obrigatório nesse modo.
 */
export function createSql(databaseUrl: string, options: { max?: number } = {}): Sql {
  return postgres(databaseUrl, {
    prepare: false,
    max: options.max ?? 5,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    transform: { ...postgres.camel, undefined: null },
    // int8 (contadores e custos em micro-dólares) cabe com folga em Number.
    types: {
      bigint: { to: 20, from: [20], serialize: (value: number) => String(value), parse: (value: string) => Number(value) },
    },
    connection: { application_name: "atendimento-ai" },
  });
}

let shared: Sql | undefined;

/** Pool compartilhado por instância de função. */
export function getSql(databaseUrl: string): Sql {
  shared ??= createSql(databaseUrl);
  return shared;
}
