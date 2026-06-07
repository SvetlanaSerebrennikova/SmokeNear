/**
 * Loads env into `process.env` (without overwriting existing vars).
 * Local: `.env.test` (gitignored) then `.env.test.defaults`.
 * CI (`CI=true`): skips `.env.test`; wallet secrets must come from GitHub Actions secrets.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

function mergeEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

const root = process.cwd();

// Local dev: `.env.test` (gitignored). CI: secrets come from GitHub Actions only — never from repo files.
if (!process.env.CI) {
  mergeEnvFile(resolve(root, '.env.test'));
}
mergeEnvFile(resolve(root, '.env.test.defaults'));
