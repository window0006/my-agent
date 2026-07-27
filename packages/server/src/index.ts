/**
 * Entry point — bootstraps and starts the Koa server.
 */
import { appendFileSync } from 'fs';

function log(msg: string) {
  try {
    appendFileSync('/tmp/myagent-bootstrap.log', `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

log('1. file loaded');

import 'dotenv/config';
log('2. dotenv loaded');

import { registerRouters } from './router';
log('3. registerRouters imported');

import { createApp } from './app';
log('4. createApp imported');

import { config } from './config';
log('5. config imported');

import { runMigrations, closeDatabase } from './repository/connection';
log('6. connection imported');

async function bootstrap() {
  log('7. bootstrap() entered');
  log('8. running migrations...');
  try {
    await runMigrations();
    log('9. migrations done');
  } catch (err) {
    log(`migration FAILED: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  log('10. creating app...');
  const app = createApp();

  log(`11. starting server on ${config.host}:${config.port}...`);
  const server = app.listen(config.port, config.host, () => {
    log(`12. server listening on http://${config.host}:${config.port}`);
  });

  const shutdown = async (signal: string) => {
    log(`${signal} received, shutting down`);
    server.close();
    await closeDatabase();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  log(`FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});