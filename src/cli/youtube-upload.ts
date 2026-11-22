// Upload a rendered Short to YouTube.
// Usage: npm run youtube:upload -- --video out/x/short.mp4 --metadata out/x/metadata.json --privacy private|unlisted|public
//        [--title "..."] [--description "..."] [--dry-run]
import { appendFileSync, readFileSync } from 'node:fs';
import { UserFacingError, runCli } from '../util/errors';
import { optionalEnv, parseArgs, requireEnv } from '../util/env';
import { normalizeMetadata, parsePrivacy, sanitizeDescription, sanitizeTitle, type YouTubeMetadata } from '../youtube/metadata';
import { DEFAULT_TOKEN_PATH, loadTokenFile, refreshAccessToken } from '../youtube/oauth';
import { buildInsertBody, uploadVideo } from '../youtube/upload';

const USAGE =
  'Usage: npm run youtube:upload -- --video <short.mp4> --metadata <metadata.json> --privacy private|unlisted|public [--title "..."] [--description "..."] [--dry-run]';

function str(v: string | boolean | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

runCli(async () => {
  const args = parseArgs();
  const video = str(args.video);
  const metadataPath = str(args.metadata);
  if (!video || !metadataPath) throw new UserFacingError('--video and --metadata are required.', USAGE);
  if (args.privacy === undefined || args.privacy === true) throw new UserFacingError('--privacy is required (no default).', USAGE);
  const privacy = parsePrivacy(args.privacy);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(metadataPath, 'utf8'));
  } catch {
    throw new UserFacingError(`Cannot read or parse metadata file ${metadataPath}.`);
  }
  const metadata: YouTubeMetadata = normalizeMetadata(raw);
  const title = str(args.title);
  const description = str(args.description);
  if (title?.trim()) metadata.title = sanitizeTitle(title);
  if (description?.trim()) metadata.description = sanitizeDescription(description);

  if (metadata.privacyStatus !== privacy) {
    throw new UserFacingError(
      `Refusing to upload: metadata was reviewed with visibility "${metadata.privacyStatus}" but --privacy is "${privacy}".`,
      'Regenerate metadata.json with the intended visibility, or pass the matching --privacy.',
    );
  }

  if (args['dry-run']) {
    console.log('Dry run — no credentials read, nothing uploaded. Request body for videos.insert:\n');
    console.log(JSON.stringify(buildInsertBody(metadata, privacy), null, 2));
    console.log(`\nVideo file: ${video}`);
    return;
  }

  const clientId = requireEnv('YOUTUBE_CLIENT_ID');
  const clientSecret = requireEnv('YOUTUBE_CLIENT_SECRET');
  const refreshToken = optionalEnv('YOUTUBE_REFRESH_TOKEN') ?? loadTokenFile(DEFAULT_TOKEN_PATH)?.refresh_token;
  if (!refreshToken) {
    throw new UserFacingError(
      'Missing YOUTUBE_REFRESH_TOKEN.',
      `Set it as an env var / GitHub secret, or run \`npm run youtube:authorize -- client_secret.json\` locally to create ${DEFAULT_TOKEN_PATH}.`,
    );
  }

  const accessToken = await refreshAccessToken({ clientId, clientSecret, refreshToken });
  console.log(`Uploading ${video} as ${privacy}…`);
  const result = await uploadVideo({ accessToken, videoPath: video, metadata, privacyStatus: privacy });
  console.log(`✔ Uploaded (${result.privacyStatus}): ${result.url}`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `\n**Uploaded to YouTube** (${result.privacyStatus}): ${result.url}\n`);
  const output = process.env.GITHUB_OUTPUT;
  if (output) appendFileSync(output, `video_id=${result.videoId}\nvideo_url=${result.url}\n`);
});
