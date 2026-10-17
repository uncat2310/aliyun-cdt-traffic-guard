import crypto from 'node:crypto';
import { logger } from './logger.js';

// ================== 阿里云 API 交互 ==================
// 直接实现 RPC 风格签名（Signature V1, HMAC-SHA1），与官方 Python SDK 的签名结果一致，
// 不依赖任何第三方 SDK。请求一律走 HTTPS（Python SDK 默认是 HTTP）。

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRYABLE_CODES = new Set(['ServiceUnavailable', 'InternalError', 'SDK.ServerUnreachable']);

const CDT_ENDPOINT = 'cdt.aliyuncs.com';
const VPC_ENDPOINT = 'vpc.aliyuncs.com';
// 与官方 SDK endpoint_data 保持一致的少数例外，其余地域使用 ecs.<region>.aliyuncs.com
const ECS_ENDPOINT_OVERRIDES = {
  'cn-hangzhou': 'ecs-cn-hangzhou.aliyuncs.com',
  'cn-fujian': 'ecs-cn-hangzhou.aliyuncs.com',
  'cn-wuhan': 'ecs.aliyuncs.com',
  'cn-zhangbei': 'ecs.aliyuncs.com',
};

// 仅供测试替换（例如指向本地 HTTP 假服务）
export const transport = {
  baseUrl: (endpoint) => `https://${endpoint}`,
};

export class AliyunApiError extends Error {
  constructor(message, { code, status, requestId } = {}) {
    super(message);
    this.name = 'AliyunApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export function ecsEndpoint(regionId) {
  return ECS_ENDPOINT_OVERRIDES[regionId] || `ecs.${regionId}.aliyuncs.com`;
}

/** RFC 3986 编码：encodeURIComponent 之外再编码 !'()* */
export function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function canonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
}

export function signRpc(method, params, secret) {
  const stringToSign = `${method}&${percentEncode('/')}&${percentEncode(canonicalQuery(params))}`;
  return crypto.createHmac('sha1', `${secret}&`).update(stringToSign).digest('base64');
}

const isoTimestamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(status, code) {
  return status >= 500 || RETRYABLE_CODES.has(code) || String(code).startsWith('Throttling');
}

export async function rpcRequest(serverCfg, { endpoint, version, action, params = {} }) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt) await sleep(500 * 2 ** (attempt - 1));

    const query = {
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      Action: action,
      Version: version,
      Format: 'JSON',
      RegionId: serverCfg.region_id,
      AccessKeyId: serverCfg.ak,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: crypto.randomUUID(),
      Timestamp: isoTimestamp(),
    };
    query.Signature = signRpc('POST', query, serverCfg.sk);

    let res;
    let text;
    try {
      res = await fetch(`${transport.baseUrl(endpoint)}/?${canonicalQuery(query)}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-acs-action': action,
          'x-acs-version': version,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      text = await res.text();
    } catch (e) {
      lastError = new AliyunApiError(`${action} request failed: ${e.cause?.message || e.message}`, {
        code: 'NetworkError',
      });
      continue;
    }

    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (res.ok && data && typeof data === 'object') return data;

    const code = data?.Code || `HTTP${res.status}`;
    lastError = new AliyunApiError(
      `HTTP Status: ${res.status} Error:${code} ${data?.Message || ''} RequestID: ${data?.RequestId || '-'}`.trim(),
      { code, status: res.status, requestId: data?.RequestId },
    );
    if (!isRetryable(res.status, code)) break;
  }
  throw lastError;
}

export function safeInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function round(value, digits = 0) {
  return Number(Number(value).toFixed(digits));
}

const serverName = (cfg) => cfg.name ?? 'Unknown';

/** 查询当月 CDT 流量 */
export async function queryCdtTraffic(serverCfg) {
  try {
    const data = await rpcRequest(serverCfg, {
      endpoint: CDT_ENDPOINT,
      version: '2021-08-13',
      action: 'ListCdtInternetTraffic',
    });
    const details = Array.isArray(data.TrafficDetails) ? data.TrafficDetails : [];
    const totalBytes = details.reduce((sum, d) => sum + (Number(d?.Traffic) || 0), 0);

    let isp = 'BGP';
    let product = 'CBWP';
    if (details.length) {
      isp = String(details[0].ISPType ?? 'bgp').toUpperCase();
      const ptd = details[0].ProductTrafficDetails || [];
      if (ptd.length) product = String(ptd[0].Product ?? 'cbwp').toUpperCase();
    }
    return {
      success: true,
      total_bytes: totalBytes,
      total_gb: round(totalBytes / 1024 ** 3, 3),
      isp,
      product,
    };
  } catch (e) {
    logger.error(`CDT query error for ${serverName(serverCfg)}: ${e.message}`);
    return { success: false, error: e.message, total_bytes: 0, total_gb: 0.0, isp: 'BGP', product: 'CBWP' };
  }
}

function collectPublicIps(inst, serverCfg) {
  const ips = new Set();
  const rawIp = String(serverCfg.ip ?? '').trim();
  if (rawIp && !rawIp.includes('*')) ips.add(rawIp);
  const eip = inst.EipAddress?.IpAddress;
  if (eip) ips.add(String(eip));
  for (const item of inst.PublicIpAddress?.IpAddress || []) {
    if (item) ips.add(String(item));
  }
  return ips;
}

/** 查询 ECS 实例详情与状态 */
export async function queryEcsInfo(serverCfg) {
  try {
    const data = await rpcRequest(serverCfg, {
      endpoint: ecsEndpoint(serverCfg.region_id),
      version: '2014-05-26',
      action: 'DescribeInstances',
      params: { InstanceIds: JSON.stringify([serverCfg.instance_id]) },
    });
    const instances = data.Instances?.Instance || [];
    if (!instances.length) {
      return { success: false, status: 'Unknown', error: 'Instance not found' };
    }
    const inst = instances[0];
    return {
      success: true,
      status: inst.Status ?? 'Unknown',
      instance_name: serverCfg.name ?? 'ECS-Node',
      instance_type: inst.InstanceType ?? 'ecs.e-c4m1.large',
      cpu: inst.Cpu ?? 2,
      memory: round((inst.Memory ?? 2048) / 1024, 1),
      internet_bw_out: safeInt(inst.InternetMaxBandwidthOut),
      eip_bandwidth: safeInt(inst.EipAddress?.Bandwidth),
      public_ips: [...collectPublicIps(inst, serverCfg)].sort(),
      os_name: 'Linux',
      creation_time: inst.CreationTime ?? '',
      expired_time: inst.ExpiredTime ?? '',
    };
  } catch (e) {
    logger.error(`ECS query error for ${serverName(serverCfg)}: ${e.message}`);
    return { success: false, status: 'Unknown', error: e.message };
  }
}

/** CDT 机器公网带宽经常是 0，真实峰值在共享带宽包 (CBWP) 上。 */
export async function querySharedBandwidth(serverCfg, publicIps) {
  try {
    const data = await rpcRequest(serverCfg, {
      endpoint: VPC_ENDPOINT,
      version: '2016-04-28',
      action: 'DescribeCommonBandwidthPackages',
      params: { PageSize: 50 },
    });
    const packages = data.CommonBandwidthPackages?.CommonBandwidthPackage || [];
    if (!packages.length) return null;

    const matched = [];
    const fallback = [];
    for (const pkg of packages) {
      const bw = safeInt(pkg.Bandwidth);
      if (!bw) continue;
      const addrs = pkg.PublicIpAddresses?.PublicIpAddresse || pkg.PublicIpAddresses?.PublicIpAddress || [];
      const pkgIps = new Set(addrs.filter((item) => item?.IpAddress).map((item) => String(item.IpAddress)));
      if (publicIps.size && [...publicIps].some((ip) => pkgIps.has(ip))) {
        matched.push(bw);
      } else {
        fallback.push(bw);
      }
    }
    if (matched.length) return Math.max(...matched);
    if (fallback.length === 1) return fallback[0];
    return null;
  } catch (e) {
    logger.warn(`CBWP query failed for ${serverName(serverCfg)}: ${e.message}`);
    return null;
  }
}

export async function setInstancePower(serverCfg, action) {
  const params = { 'InstanceId.1': serverCfg.instance_id };
  if (action !== 'start') params.ForceStop = 'false';
  const data = await rpcRequest(serverCfg, {
    endpoint: ecsEndpoint(serverCfg.region_id),
    version: '2014-05-26',
    action: action === 'start' ? 'StartInstances' : 'StopInstances',
    params,
  });
  logger.info(
    `Guard ${action} ${serverCfg.name ?? serverCfg.id} (${serverCfg.instance_id}): ${JSON.stringify(data)}`,
  );
}
