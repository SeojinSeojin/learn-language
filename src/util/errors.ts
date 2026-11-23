import { appendFileSync } from 'node:fs';

/** An error whose message is safe and useful to show the user as-is (no stack needed). */
export class UserFacingError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** A free-tier quota or rate limit was exhausted. Never retried with a paid fallback. */
export class QuotaExhaustedError extends UserFacingError {
  constructor(service: string, detail: string, hint?: string) {
    super(`${service}: free-tier quota or rate limit exhausted. ${detail}`.trim(), hint);
    this.name = 'QuotaExhaustedError';
  }
}

/** Run a CLI main() with consistent error reporting and exit codes. */
export async function runCli(main: () => Promise<void>) {
  try {
    await main();
  } catch (err) {
    if (err instanceof UserFacingError) {
      console.error(`\n✖ ${err.message}`);
      if (err.hint) console.error(`  → ${err.hint}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::error title=${err.name}::${err.message.replace(/\r?\n/g, ' ')}`);
      if (err instanceof QuotaExhaustedError && process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, 'provider_quota=true\n');
      }
      process.exit(err instanceof QuotaExhaustedError ? 3 : 2);
    }
    console.error(err);
    process.exit(1);
  }
}
