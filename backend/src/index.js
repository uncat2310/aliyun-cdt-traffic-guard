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

  // 先监听端口再预热：预热期间到达的请求会等待同一次查询完成，而不是连接被拒绝
  // （重启时前置的反向代理不会因此返回 502）
  const server = createDashboardServer();
  server.on('error', (e) => {
    logger.error(`HTTP server error: ${e.message}`);
    process.exit(1);
  });
  server.listen(port, host);

  try {
    await Promise.all([overviewCache.get(true), historyCache.get(true)]);
  } catch (e) {
    logger.error(`Initial data warm-up failed: ${e.message}`);
  }
  startPoller();

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
