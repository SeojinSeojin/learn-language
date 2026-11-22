// One-time local step: obtain a YouTube upload refresh token via the browser.
// Usage: npm run youtube:authorize -- ./client_secret.json [--out .secrets/youtube-token.json] [--no-browser]
import { UserFacingError, runCli } from '../util/errors';
import { parseArgs } from '../util/env';
import { DEFAULT_TOKEN_PATH, authorizeInteractive, loadClientSecret, saveTokenFile } from '../youtube/oauth';

const USAGE = `Usage: npm run youtube:authorize -- <client_secret.json> [--out ${DEFAULT_TOKEN_PATH}] [--no-browser]

  <client_secret.json>  OAuth client JSON of type "Desktop app" downloaded from
                        Google Cloud Console → APIs & Services → Credentials.`;

runCli(async () => {
  const args = parseArgs();
  if (args.help || args.h) {
    console.log(USAGE);
    return;
  }
  const clientPath = args._[0];
  if (!clientPath) throw new UserFacingError('Missing path to the OAuth client JSON.', USAGE);
  const out = typeof args.out === 'string' && args.out ? args.out : DEFAULT_TOKEN_PATH;
  const openBrowser = !args['no-browser'];

  const { clientId, clientSecret } = loadClientSecret(clientPath);
  const result = await authorizeInteractive({ clientId, clientSecret, openBrowser });
  saveTokenFile(out, result);

  console.log(`\n✔ Authorized. Refresh token saved to ${out} (permissions 0600). It is not printed here.\n`);
  console.log('Next steps — store the credentials as GitHub Actions secrets (values are piped, never echoed):\n');
  console.log(`  jq -r .refresh_token ${out} | gh secret set YOUTUBE_REFRESH_TOKEN`);
  console.log(`  jq -r .installed.client_id ${clientPath} | gh secret set YOUTUBE_CLIENT_ID`);
  console.log(`  jq -r .installed.client_secret ${clientPath} | gh secret set YOUTUBE_CLIENT_SECRET`);
  console.log('\nKeep client_secret*.json and .secrets/ out of Git (both are gitignored). Do not commit or share them.');
  console.log('Tip: if the OAuth consent screen is in "Testing" status, refresh tokens expire after 7 days — set it to "In production".');
});
