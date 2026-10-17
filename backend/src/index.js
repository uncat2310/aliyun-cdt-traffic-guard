#!/usr/bin/env node
/**
 * Alibaba Cloud CDT Traffic Guard & Monitoring Dashboard Service
 * High-Performance SSR-Lite & In-Memory Pre-Warming Server
 */
import { SERVERS, SKIPPED_SERVERS, settings } from './config.js';
import { logger } from './logger.js';
import { overviewCache, historyCache, startPoller } from './monitor.js';
import { createDashboardServer } from './server.js';

async function main() {
  const { host, port } = settings;
  const nodes = Object.keys(SERVERS);
  logger.info(`Starting High-Performance Traffic Guard Server on ${host}:${port}`);
  logger.info(`Configured nodes: ${nodes.length} (${nodes.join(', ') || 'none'})`);
  if (SKIPPED_SERVERS.length) {
    logger.warn(`Skipped placeholder / incomplete nodes: ${SKIPPED_SERVERS.join(', ')}`);
  }

  try {
    await Promise.all([overviewCache.get(true), historyCache.get(true)]);
  } catch (e) {
    logger.error(`Initial data warm-up failed: ${e.message}`);
  }
  startPoller();

  const server = createDashboardServer();
  server.on('error', (e) => {
    logger.error(`HTTP server error: ${e.message}`);
    process.exit(1);
  });
  server.listen(port, host);

  // 容器里 Node 是 PID 1，不处理信号的话 docker stop 要等 10 秒被强杀
  const shutdown = () => {
    logger.info('Service shutting down...');
    server.close();
    server.closeAllConnections();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (e) => logger.error(`Unhandled rejection: ${e?.stack || e}`));

main();
