/**
 * Carrega .env.local / .env para os scripts de CLI (o Next.js já faz isso sozinho).
 * Variáveis já definidas no ambiente têm prioridade.
 */
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // arquivo ausente: segue com o ambiente atual
  }
}
