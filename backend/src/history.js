import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { logger, formatLogStamp } from './logger.js';
import { round } from './aliyun.js';

// ================== 历史日志解析 ==================
const LOG_TRAFFIC_REGEX = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ - INFO - 当月CDT流量使用: ([\d.]+) GB/;
const NEWLINE = 0x0a;

/** 单个日志文件的增量解析状态：只读取上次之后新追加的内容。 */
class LogFileState {
  constructor(inode) {
    this.inode = inode;
    this.offset = 0;
    this.hourly = new Map();
    this.daily = new Map();
  }

  ingest(line) {
    const m = LOG_TRAFFIC_REGEX.exec(line);
    if (!m) return;
    const [, timeStr, gbStr] = m;
    const val = Number(gbStr);
    if (!Number.isFinite(val)) return;
    this.hourly.set(`${timeStr.slice(0, 13)}:00`, val);
    const dayKey = timeStr.slice(0, 10);
    const info = this.daily.get(dayKey);
    if (!info) {
      this.daily.set(dayKey, { min: val, max: val, first: val, last: val });
    } else {
      if (val > info.max) info.max = val;
      if (val < info.min) info.min = val;
      info.last = val;
    }
  }
}

const logStates = new Map();
let parseQueue = Promise.resolve();

async function readLogIncremental(logFile) {
  let st;
  try {
    st = await fsp.stat(logFile);
  } catch {
    return null;
  }
  let state = logStates.get(logFile);
  // 文件被轮转 / 截断时重新解析
  if (!state || state.inode !== st.ino || st.size < state.offset) {
    state = new LogFileState(st.ino);
    logStates.set(logFile, state);
  }
  if (st.size === state.offset) return state;

  let chunk;
  try {
    const handle = await fsp.open(logFile, 'r');
    try {
      chunk = Buffer.alloc(st.size - state.offset);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, state.offset);
      chunk = chunk.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch (e) {
    logger.error(`Error parsing log file ${logFile}: ${e.message}`);
    return state;
  }
  // 只处理完整行，末尾未写完的半行留到下一轮
  const end = chunk.lastIndexOf(NEWLINE) + 1;
  if (end <= 0) return state;
  for (const line of chunk.subarray(0, end).toString('utf8').split(/\r?\n|\r/)) {
    state.ingest(line);
  }
  state.offset += end;
  return state;
}

async function collectHistory(logFiles) {
  const hourlyMap = new Map();
  const dailyMap = new Map();

  for (const logFile of [...logFiles].reverse()) {
    if (!logFile) continue;
    const state = await readLogIncremental(logFile);
    if (!state) continue;
    for (const [hour, val] of state.hourly) hourlyMap.set(hour, val);
    for (const [day, info] of state.daily) {
      const merged = dailyMap.get(day);
      if (!merged) {
        dailyMap.set(day, { ...info });
      } else {
        merged.max = Math.max(merged.max, info.max);
        merged.min = Math.min(merged.min, info.min);
        merged.last = info.last;
      }
    }
  }

  const sortedHours = [...hourlyMap.keys()].sort().slice(-168);
  const hourly = sortedHours.map((time) => ({ time, traffic_gb: hourlyMap.get(time) }));

  const sortedDays = [...dailyMap.keys()].sort();
  const daily = sortedDays.map((date, i) => {
    const info = dailyMap.get(date);
    const delta = i === 0
      ? round(info.max - info.min, 3)
      : round(Math.max(0, info.last - dailyMap.get(sortedDays[i - 1]).last), 3);
    return { date, delta_gb: Math.max(0.0, delta), cum_gb: info.last };
  });

  return { hourly, daily };
}

export function parseServerHistory(logFiles) {
  // 串行化，避免两个并发调用同时推进同一文件的 offset
  const run = parseQueue.then(() => collectHistory(logFiles));
  parseQueue = run.catch(() => {});
  return run;
}

export function historyLogPath(sKey, sCfg, historyDir) {
  const files = (sCfg.log_files || []).filter(Boolean);
  if (files.length) return files[0];
  fs.mkdirSync(historyDir, { recursive: true });
  return path.join(historyDir, `${sKey}.log`);
}

export async function appendTrafficLog(sKey, sCfg, usedGb, historyDir) {
  const file = historyLogPath(sKey, sCfg, historyDir);
  const parent = path.dirname(file);
  if (parent) await fsp.mkdir(parent, { recursive: true });
  const line = `${formatLogStamp()} - INFO - 当月CDT流量使用: ${Number(usedGb).toFixed(2)} GB\n`;
  await fsp.appendFile(file, line, 'utf8');
  const files = sCfg.log_files || [];
  if (!files.includes(file)) sCfg.log_files = [file, ...files];
}
