#!/usr/bin/env node
/**
 * Optional one-shot guard for crontab.
 *
 * The dashboard service already runs this loop every minute.
 * Only use this script if you want a separate cron process.
 *
 *   CONFIG_PATH=/path/to/config.json node scripts/auto-traffic-guard.mjs
 */
import { computeOverviewData, enforceGuards } from '../backend/src/monitor.js';

const overview = await computeOverviewData();
await enforceGuards(overview);
console.log('guard cycle done');
// 不等 HTTP keep-alive 连接自然超时
process.exit(0);
