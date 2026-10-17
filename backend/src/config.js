import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATIC_DIR = path.join(BACKEND_DIR, 'dashboard_dist');
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(BACKEND_DIR, 'config.json');
const EXAMPLE_CONFIG_PATH = path.join(BACKEND_DIR, 'config.example.json');

// ================== 配置加载 ==================
const DEFAULT_CONFIG = {
  host: '0.0.0.0',
  port: 8388,
  node_tag: 'Guard-Master',
  servers: {
    server1: {
      id: 'server1',
      name: '节点 01',
      masked_ip: '1.2.*.*',
      ip: '1.2.3.4',
      instance_id: 'i-example1',
      region_id: 'cn-hongkong',
      ak: 'YOUR_ALIYUN_ACCESS_KEY_ID',
      sk: 'YOUR_ALIYUN_ACCESS_KEY_SECRET',
      threshold_gb: 180.0,
      bandwidth_mbps: 2000,
      log_files: ['/opt/auto/auto1.log'],
    },
  },
};

export function loadConfig() {
  const target = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : EXAMPLE_CONFIG_PATH;
  if (fs.existsSync(target)) {
    try {
      return JSON.parse(fs.readFileSync(target, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      console.warn(`[WARN] Failed to parse config file ${target}: ${e.message}`);
    }
  }
  return structuredClone(DEFAULT_CONFIG);
}

const PLACEHOLDER_MARKERS = ['YOUR_ALIYUN', 'YOUR_ACCESS', 'i-xxxxxxxx', 'i-example', 'i-yourinstanceid'];

// 与前端 frontend/src/App.jsx 的 SERIES_COLORS 保持一致（图表直接使用这里下发的颜色）
export const SERIES_COLORS = [
  '#38bdf8',
  '#818cf8',
  '#34d399',
  '#fbbf24',
  '#f43f5e',
  '#a78bfa',
  '#2dd4bf',
  '#fb923c',
];

/** 跳过示例占位节点，避免单机用户复制 example 后仍显示两台。 */
export function isConfiguredServer(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return false;
  const ak = String(cfg.ak ?? '').trim();
  const sk = String(cfg.sk ?? '').trim();
  const instanceId = String(cfg.instance_id ?? '').trim();
  if (!ak || !sk || !instanceId) return false;
  const blob = `${ak} ${sk} ${instanceId}`.toLowerCase();
  return !PLACEHOLDER_MARKERS.some((marker) => blob.includes(marker.toLowerCase()));
}

export function nodeCountLabel(count) {
  if (count <= 0) return '未配置';
  if (count === 1) return '单机';
  if (count === 2) return '两机';
  return `${count}机`;
}

export function toFloat(value, fallback) {
  const number = Number(value);
  return value === null || value === '' || !Number.isFinite(number) ? fallback : number;
}

const flag = (value, fallback) => (value === undefined ? fallback : Boolean(value));

export const CONFIG = loadConfig();
const RAW_SERVERS = CONFIG.servers && typeof CONFIG.servers === 'object' ? CONFIG.servers : {};

export const SERVERS = Object.fromEntries(
  Object.entries(RAW_SERVERS).filter(([, cfg]) => isConfiguredServer(cfg)),
);
export const SKIPPED_SERVERS = Object.keys(RAW_SERVERS).filter((key) => !(key in SERVERS));

// 运行期设置集中在一个对象里（测试可以直接改写）
export const settings = {
  host: CONFIG.host || '0.0.0.0',
  port: CONFIG.port ?? 8388,
  nodeTag: CONFIG.node_tag ?? 'Guard-Master',
  guardEnabled: flag(CONFIG.guard_enabled, true),
  guardAutoStart: flag(CONFIG.guard_auto_start, true),
  guardIntervalMs: Math.max(15, Math.trunc(toFloat(CONFIG.guard_interval_seconds, 60))) * 1000,
  historyDir: CONFIG.history_dir || path.join(BACKEND_DIR, 'history'),
  // 可选 HTTP Basic 认证：设置密码即启用（环境变量优先于 config.json）
  authUsername: process.env.DASHBOARD_USERNAME || String(CONFIG.auth_username || 'admin'),
  authPassword: process.env.DASHBOARD_PASSWORD || String(CONFIG.auth_password || ''),
  // 默认不发送 CORS 头（面板与 API 同源）；需要跨域时显式配置允许的 Origin
  corsAllowOrigin: String(CONFIG.cors_allow_origin || '').trim(),
  overviewTtlMs: 20_000,
  historyTtlMs: 30_000,
  // 两次强制刷新之间的最短间隔，防止匿名请求刷爆阿里云 API 配额
  forceRefreshMinIntervalMs: 5_000,
  pollIntervalMs: 12_000,
  bandwidthCacheTtlMs: 600_000,
};
