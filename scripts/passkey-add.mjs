import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

async function main() {
  if (process.argv.length > 2) {
    throw new Error("This command does not accept arguments. Run: npm run passkey:add");
  }

  const wranglerToml = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");

  const dbName = extractPasskeysDbName(wranglerToml);
  if (!dbName) {
    throw new Error("Could not resolve D1 database name from PASSKEYS_DB in wrangler.toml.");
  }

  const origin = trimTrailingSlash(extractPasskeyOrigin(wranglerToml));
  if (!origin) {
    throw new Error("Could not resolve PASSKEY_ORIGIN in wrangler.toml.");
  }

  const ttlHours = 24;
  const token = randomBytes(32).toString("base64url");
  const sql = `INSERT INTO registration_tokens (token, expires_at, used_at) VALUES ('${token}', datetime('now', '+${ttlHours} hours'), NULL);`;

  const execution = await runWithOutput("npx", [
    "wrangler",
    "d1",
    "execute",
    dbName,
    "--remote",
    "--command",
    sql
  ]);
  if (execution.code !== 0) {
    const out = `${execution.stdout}\n${execution.stderr}`;
    if (/no such table:\s*registration_tokens/i.test(out)) {
      throw new Error(
        "Missing D1 tables. Run migrations first: npx wrangler d1 migrations apply " +
          `${dbName} --remote`
      );
    }
    throw new Error(`wrangler d1 execute failed with code ${execution.code}`);
  }

  console.log("");
  console.log("One-time registration token created.");
  console.log(`Token: ${token}`);
  console.log(`Registration URL: ${origin}/auth/register/${token}`);
}

function extractPasskeysDbName(toml) {
  const blockRegex =
    /\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"PASSKEYS_DB"[\s\S]*?database_name\s*=\s*"([^"]+)"/m;
  const match = toml.match(blockRegex);
  return match ? match[1] : "";
}

function extractPasskeyOrigin(toml) {
  const match = toml.match(/^\s*PASSKEY_ORIGIN\s*=\s*"([^"]+)"/m);
  return match ? match[1] : "";
}

function trimTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function runWithOutput(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ["inherit", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("exit", (code) => resolve({ code: Number(code || 0), stdout, stderr }));
    child.on("error", reject);
  });
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
