#!/usr/bin/env node
/**
 * Bundle packages/server/src/index.ts into a single CJS file at
 * packages/server/dist/bundle.cjs using esbuild. This is the production
 * build path: pnpm + macOS file-stat makes `node dist/index.js` take
 * 100+ seconds on cold start, while the bundled file starts in ~5s.
 *
 * Usage from repo root: `node tools/build-bundle.cjs`
 */
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'packages', 'server');

esbuild
  .build({
    entryPoints: [path.join(SERVER, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    outfile: path.join(SERVER, 'dist', 'bundle.cjs'),
    format: 'cjs',

    // Externalise everything that should be resolved at runtime, not bundled.
    // esbuild's external syntax lets us glob for all node_modules.
    external: [
      'fsevents',
      'koa', 'koa-*', '@koa/*',
      'mysql2',
      'drizzle-orm', 'drizzle-orm/*',
      'langchain', '@langchain/*',
      '@my-agent/*',
      'zod', 'uuid', 'dotenv',
    ],
    sourcemap: false,
    minify: false,
    // Tell esbuild to NOT try to bundle anything under node_modules.
    packages: 'external',
    // Allow all the dynamic imports to resolve.
    logLevel: 'warning',
  })
  .then(() => console.log('BUNDLED OK -> packages/server/dist/bundle.cjs'))
  .catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
