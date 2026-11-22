import { build } from 'vite';
import { fileURLToPath } from 'node:url';

export const WEB_DIST = fileURLToPath(new URL('../../dist/web', import.meta.url));

/** Bundles the PixiJS scene (web/) into dist/web. The bundle contains no credentials. */
export async function buildWeb() {
  await build({ configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), logLevel: 'warn' });
  return WEB_DIST;
}
