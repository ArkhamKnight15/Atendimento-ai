/**
 * Gera valores aleatórios seguros para as variáveis de ambiente secretas.
 *
 *   npm run keys:generate
 */
import { randomBytes } from "node:crypto";
import { generateKey } from "../src/server/lib/crypto";

console.log("# Cole no seu .env.local (e nas variáveis do projeto na Vercel). Nunca versione estes valores.");
console.log(`CREDENTIALS_ENCRYPTION_KEY=${generateKey()}`);
console.log(`WHATSAPP_WEBHOOK_VERIFY_TOKEN=${randomBytes(24).toString("base64url")}`);
console.log(`CRON_SECRET=${randomBytes(32).toString("base64url")}`);
