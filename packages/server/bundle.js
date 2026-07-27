const esbuild = require('/Users/windowyang/Desktop/MyAgent/node_modules/.pnpm/esbuild@0.21.3/node_modules/esbuild');
// Mark all node_modules as external — Node resolves them at runtime via the
// existing node_modules directory. Bundling them in would produce a giant
// self-contained file but break when dependencies update.
esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: 'dist/bundle.cjs',
  format: 'cjs',
  // Externalise everything that should be resolved at runtime, not bundled.
  // esbuild's external syntax lets us glob for all node_modules.
  external: ['fsevents', 'koa', 'koa-*', '@koa/*', 'mysql2', 'drizzle-orm', 'drizzle-orm/*', 'langchain', '@langchain/*', '@my-agent/*', 'zod', 'uuid', 'dotenv'],
  sourcemap: false,
  minify: false,
  // Tell esbuild to NOT try to bundle anything under node_modules.
  packages: 'external',
  // Allow all the dynamic imports to resolve.
  logLevel: 'warning',
}).then(() => console.log('BUNDLED OK')).catch(err => { console.error('FAILED:', err.message); process.exit(1); });