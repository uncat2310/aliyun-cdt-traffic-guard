import { SERVERS, SERIES_COLORS, settings, nodeCountLabel, toFloat } from './config.js';
import { logger, formatDateTime } from './logger.js';
import * as aliyun from './aliyun.js';
import { round, safeInt } from './aliyun.js';
import { parseServerHistory, historyLogPath, appendTrafficLog } from './history.js';
import { createPayload } from './payload.js';

// 阿里云调用集中在这里，测试可以替换成假实现
export const api = {
  queryCdtTraffic: aliyun.queryCdtTraffic,
  queryEcsInfo: aliyun.queryEcsInfo,
  querySharedBandwidth: aliyun.querySharedBandwidth,
  setInstancePower: aliyun.setInstancePower,
};

const bandwidthCache = new Map();

export async function resolveBandwidthMbps(serverCfg, ecs) {
  const cfgBw = safeInt(serverCfg.bandwidth_mbps);
  if (cfgBw) return cfgBw;
  const ecsBw = safeInt(ecs.internet_bw_out) || safeInt(ecs.eip_bandwidth);
  if (ecsBw) return ecsBw;
  // 共享带宽包几乎不变，缓存结果（包括失败）以免每轮轮询都多打一次 VPC API
  const publicIps = [...new Set(ecs.public_ips || [])].sort();
  const key = [serverCfg.ak, serverCfg.region_id, serverCfg.instance_id, ...publicIps].join('|');
  const now = Date.now();
  const cached = bandwidthCache.get(key);
  if (cached && cached.expires > now) return cached.value;
  const value = await api.querySharedBandwidth(serverCfg, new Set(publicIps));
  bandwidthCache.set(key, { value, expires: now + settings.bandwidthCacheTtlMs });
  return value;
}

// ================== 守卫 ==================
export async function enforceGuards(overview) {
  const servers = overview?.servers || {};
  for (const [sKey, sCfg] of Object.entries(SERVERS)) {
    const node = servers[sKey] || {};
    const traffic = node.traffic || {};
    const name = sCfg.name ?? sKey;
    if (!traffic.query_ok) {
      logger.warn(`Skip guard/history for ${name}: CDT query failed`);
      continue;
    }
    const used = Number(traffic.used_gb) || 0;
    try {
      await appendTrafficLog(sKey, sCfg, used, settings.historyDir);
    } catch (e) {
      logger.error(`Failed to append history log for ${name}: ${e.message}`);
    }

    if (!settings.guardEnabled || sCfg.guard_enabled === false) continue;
    const threshold = toFloat(sCfg.threshold_gb, 180.0);
    const { status } = node;
    const usage = `${used.toFixed(2)} / ${threshold.toFixed(0)} GB`;
    try {
      if (used >= threshold) {
        if (status === 'Stopped' || status === 'Stopping') {
          logger.info(`Guard ${name} already ${status.toLowerCase()} (${usage})`);
          continue;
        }
        // 状态未知时仍尝试关机：超额风险优先
        logger.warn(`Guard stop ${name}: ${used.toFixed(2)} GB >= ${threshold.toFixed(0)} GB`);
        await api.setInstancePower(sCfg, 'stop');
      } else if (settings.guardAutoStart && (sCfg.guard_auto_start === undefined || sCfg.guard_auto_start)) {
        // 只在确认已停止时开机；ECS 查询失败 (Unknown) 或处于过渡状态时不动
        if (status !== 'Stopped') continue;
        logger.info(`Guard start ${name}: ${used.toFixed(2)} GB < ${threshold.toFixed(0)} GB`);
        await api.setInstancePower(sCfg, 'start');
      }
    } catch (e) {
      logger.error(`Guard action failed for ${name}: ${e.message}`);
    }
  }
}

// ================== 数据汇总生成 ==================
/** 对外输出时去掉真实公网 IP 与原始异常信息（可能含 AccessKeyId / RequestId）。 */
export function publicEcsInfo(ecs) {
  const { public_ips: _ips, error: _error, ...rest } = ecs;
  if (!ecs.success) rest.error = 'ECS query failed';
  return rest;
}

/** 并发查询所有节点的 CDT / ECS / 带宽，耗时约为一次往返而不是 N 次串行。 */
async function queryServer(sCfg) {
  const [cdt, ecs] = await Promise.all([api.queryCdtTraffic(sCfg), api.queryEcsInfo(sCfg)]);
  const bandwidthMbps = await resolveBandwidthMbps(sCfg, ecs);
  return { cdt, ecs, bandwidthMbps };
}

export async function computeOverviewData() {
  const now = new Date();
  const dayOfMonth = Math.max(1, now.getDate());
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const entries = Object.entries(SERVERS);
  const results = await Promise.all(entries.map(([, sCfg]) => queryServer(sCfg)));

  const serversData = {};
  let combinedUsedGb = 0.0;
  let combinedThresholdGb = 0.0;

  entries.forEach(([sKey, sCfg], idx) => {
    const { cdt, ecs, bandwidthMbps } = results[idx];
    const usedGb = cdt.total_gb;
    const thresholdGb = toFloat(sCfg.threshold_gb, 180.0);
    const remainingGb = Math.max(0.0, round(thresholdGb - usedGb, 3));
    const pct = thresholdGb > 0 ? round((usedGb / thresholdGb) * 100, 1) : 0.0;

    const dailyAvg = round(usedGb / dayOfMonth, 2);
    const daysLeft = dailyAvg > 0 ? round(remainingGb / dailyAvg, 1) : 999.0;
    const projectedMonthEnd = round(dailyAvg * daysInMonth, 2);

    combinedUsedGb += usedGb;
    combinedThresholdGb += thresholdGb;

    serversData[sKey] = {
      id: sKey,
      name: sCfg.name ?? sKey,
      ip: sCfg.masked_ip ?? '*.*.*.*',
      instance_id: `${String(sCfg.instance_id ?? 'i-xxx').slice(0, 10)}...`,
      region_id: sCfg.region_id ?? 'cn-hongkong',
      region_name: '阿里云香港',
      status: ecs.status ?? 'Unknown',
      ecs_info: publicEcsInfo(ecs),
      traffic: {
        used_gb: usedGb,
        used_bytes: cdt.total_bytes ?? 0,
        threshold_gb: thresholdGb,
        remaining_gb: remainingGb,
        percentage: pct,
        isp: cdt.isp ?? 'BGP',
        product: cdt.product ?? 'CBWP',
        bandwidth_mbps: bandwidthMbps,
        daily_avg_gb: dailyAvg,
        days_left_est: daysLeft,
        projected_month_end_gb: projectedMonthEnd,
        near_limit: pct >= 85.0,
        exceeded: pct >= 100.0,
        query_ok: Boolean(cdt.success),
      },
      network: {
        online: true,
        status: 'active',
        detail: '香港 BGP 专线',
      },
    };
  });

  const combinedPct = combinedThresholdGb > 0 ? round((combinedUsedGb / combinedThresholdGb) * 100, 1) : 0.0;
  const nodeTotal = Object.keys(serversData).length;
  const runningCount = Object.values(serversData).filter((s) => s.status === 'Running').length;

  return {
    timestamp: formatDateTime(),
    node_tag: settings.nodeTag,
    summary: {
      total_used_gb: round(combinedUsedGb, 3),
      total_threshold_gb: round(combinedThresholdGb, 1),
      total_remaining_gb: round(Math.max(0.0, combinedThresholdGb - combinedUsedGb), 3),
      total_percentage: combinedPct,
      nodes_online: runningCount,
      nodes_total: nodeTotal,
      running_count: runningCount,
      node_count_label: nodeCountLabel(nodeTotal),
    },
    server_ids: Object.keys(serversData),
    servers: serversData,
  };
}

export function buildServerSeriesMeta() {
  return Object.entries(SERVERS).map(([sKey, sCfg], idx) => ({
    id: sKey,
    name: sCfg.name ?? sKey,
    masked_ip: sCfg.masked_ip ?? '*.*.*.*',
    color: SERIES_COLORS[idx % SERIES_COLORS.length],
  }));
}

export async function computeHistoryData() {
  const serverKeys = Object.keys(SERVERS);
  const parsed = {};
  for (const [sKey, sCfg] of Object.entries(SERVERS)) {
    const logs = sCfg.log_files?.length ? sCfg.log_files : [historyLogPath(sKey, sCfg, settings.historyDir)];
    parsed[sKey] = await parseServerHistory(logs);
  }

  const hourlyDict = new Map();
  for (const [sKey, hist] of Object.entries(parsed)) {
    for (const pt of hist.hourly) {
      if (!hourlyDict.has(pt.time)) hourlyDict.set(pt.time, { time: pt.time, values: {} });
      const item = hourlyDict.get(pt.time);
      item.values[sKey] = pt.traffic_gb;
      item[`${sKey}_gb`] = pt.traffic_gb;
    }
  }

  const mergedHourly = [...hourlyDict.keys()].sort().map((t) => {
    const item = hourlyDict.get(t);
    let total = 0.0;
    for (const sKey of serverKeys) {
      if (item.values[sKey] === undefined) item.values[sKey] = 0.0;
      total += item.values[sKey];
    }
    item.total_gb = round(total, 3);
    return item;
  });

  const dailyDict = new Map();
  for (const [sKey, hist] of Object.entries(parsed)) {
    for (const pt of hist.daily) {
      if (!dailyDict.has(pt.date)) dailyDict.set(pt.date, { date: pt.date, values: {}, cum_values: {} });
      const item = dailyDict.get(pt.date);
      item.values[sKey] = pt.delta_gb;
      item.cum_values[sKey] = pt.cum_gb;
      item[`${sKey}_delta_gb`] = pt.delta_gb;
      item[`${sKey}_cum_gb`] = pt.cum_gb;
    }
  }

  const mergedDaily = [...dailyDict.keys()].sort().map((d) => {
    const item = dailyDict.get(d);
    let total = 0.0;
    for (const sKey of serverKeys) {
      if (item.values[sKey] === undefined) {
        item.values[sKey] = 0.0;
        item[`${sKey}_delta_gb`] = 0.0;
      }
      total += item.values[sKey];
    }
    item.total_delta_gb = round(total, 3);
    return item;
  });

  const nowMin = formatDateTime().slice(0, 16);
  const last = mergedHourly.at(-1);
  if (last && last.time !== nowMin) {
    const latest = { time: nowMin, values: { ...last.values }, total_gb: last.total_gb ?? 0.0 };
    for (const [sKey, v] of Object.entries(latest.values)) latest[`${sKey}_gb`] = v;
    mergedHourly.push(latest);
  }

  return {
    timestamp: formatDateTime(),
    servers: buildServerSeriesMeta(),
    hourly: mergedHourly.slice(-72),
    daily: mergedDaily.slice(-14),
  };
}

// ================== 缓存层 ==================
/**
 * 读请求直接返回内存快照；只有过期或强制刷新时才计算。
 * 并发的刷新请求会合并成同一次计算，overview 与 history 互不阻塞。
 * 快照里预先存好序列化 + gzip 后的响应体，同一份数据不重复编码。
 */
export class CachedResource {
  constructor(compute, ttlMs) {
    this.compute = compute;
    this.ttlMs = ttlMs;
    this.snapshot = null;
    this.pending = null;
  }

  isFresh(snap, force) {
    if (!snap) return false;
    const age = Date.now() - snap.created;
    return force ? age < settings.forceRefreshMinIntervalMs : age <= this.ttlMs;
  }

  async get(force = false) {
    if (this.isFresh(this.snapshot, force)) return this.snapshot;
    if (!this.pending) {
      this.pending = (async () => {
        try {
          const data = await this.compute();
          const payload = await createPayload(Buffer.from(JSON.stringify(data)));
          this.snapshot = { data, payload, created: Date.now() };
          return this.snapshot;
        } finally {
          this.pending = null;
        }
      })();
    }
    return this.pending;
  }
}

export const overviewCache = new CachedResource(() => computeOverviewData(), settings.overviewTtlMs);
export const historyCache = new CachedResource(() => computeHistoryData(), settings.historyTtlMs);

export const getCachedOverview = async (force = false) => (await overviewCache.get(force)).data;
export const getCachedHistory = async (force = false) => (await historyCache.get(force)).data;

let lastGuardAt = 0;

export async function pollOnce() {
  const overview = await getCachedOverview(true);
  const now = Date.now();
  if (now - lastGuardAt >= settings.guardIntervalMs) {
    await enforceGuards(overview);
    lastGuardAt = now;
  }
  await getCachedHistory(true);
}

export function startPoller() {
  logger.info(
    `Background traffic poller started (guard=${settings.guardEnabled}, ` +
      `interval=${settings.guardIntervalMs / 1000}s, auto_start=${settings.guardAutoStart}).`,
  );
  const loop = async () => {
    try {
      await pollOnce();
    } catch (e) {
      logger.error(`Error in background poller: ${e.message}`);
    }
    setTimeout(loop, settings.pollIntervalMs);
  };
  loop();
}
