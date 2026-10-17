#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Alibaba Cloud CDT Traffic Guard & Monitoring Dashboard Service
High-Performance SSR-Lite & In-Memory Pre-Warming Server
"""

import os
import re
import sys
import hmac
import json
import time
import gzip
import base64
import calendar
import logging
import posixpath
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import urllib.parse

from aliyunsdkcore.client import AcsClient
from aliyunsdkcore.request import CommonRequest
from aliyunsdkecs.request.v20140526 import (
    DescribeInstancesRequest,
    StartInstancesRequest,
    StopInstancesRequest,
)

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(CURRENT_DIR, "dashboard_dist")
CONFIG_PATH = os.environ.get("CONFIG_PATH") or os.path.join(CURRENT_DIR, "config.json")
EXAMPLE_CONFIG_PATH = os.path.join(CURRENT_DIR, "config.example.json")

# ================== 配置加载 ==================
def load_config():
    target = CONFIG_PATH if os.path.exists(CONFIG_PATH) else EXAMPLE_CONFIG_PATH
    if os.path.exists(target):
        try:
            with open(target, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[WARN] Failed to parse config file {target}: {e}")

    return {
        "host": "0.0.0.0",
        "port": 8388,
        "node_tag": "Guard-Master",
        "servers": {
            "server1": {
                "id": "server1",
                "name": "节点 01",
                "masked_ip": "1.2.*.*",
                "ip": "1.2.3.4",
                "instance_id": "i-example1",
                "region_id": "cn-hongkong",
                "ak": "YOUR_ALIYUN_ACCESS_KEY_ID",
                "sk": "YOUR_ALIYUN_ACCESS_KEY_SECRET",
                "threshold_gb": 180.0,
                "bandwidth_mbps": 2000,
                "log_files": ["/opt/auto/auto1.log"]
            }
        }
    }

PLACEHOLDER_MARKERS = (
    "YOUR_ALIYUN",
    "YOUR_ACCESS",
    "i-xxxxxxxx",
    "i-example",
    "i-yourinstanceid",
)

SERIES_COLORS = (
    "#0ea5e9",
    "#6366f1",
    "#10b981",
    "#f59e0b",
    "#f43f5e",
    "#8b5cf6",
    "#14b8a6",
    "#f97316",
)


def is_configured_server(cfg):
    """跳过示例占位节点，避免单机用户复制 example 后仍显示两台。"""
    if not isinstance(cfg, dict):
        return False
    ak = str(cfg.get("ak") or "").strip()
    sk = str(cfg.get("sk") or "").strip()
    instance_id = str(cfg.get("instance_id") or "").strip()
    if not ak or not sk or not instance_id:
        return False
    blob = f"{ak} {sk} {instance_id}"
    return not any(marker.lower() in blob.lower() for marker in PLACEHOLDER_MARKERS)


def node_count_label(count):
    if count <= 0:
        return "未配置"
    if count == 1:
        return "单机"
    if count == 2:
        return "两机"
    return f"{count}机"


def _safe_float(value, default):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


CONFIG = load_config()
HOST = CONFIG.get("host", "0.0.0.0")
PORT = CONFIG.get("port", 8388)
GUARD_ENABLED = bool(CONFIG.get("guard_enabled", True))
GUARD_AUTO_START = bool(CONFIG.get("guard_auto_start", True))
GUARD_INTERVAL = max(15, int(CONFIG.get("guard_interval_seconds", 60)))
HISTORY_DIR = CONFIG.get("history_dir") or os.path.join(CURRENT_DIR, "history")
_RAW_SERVERS = CONFIG.get("servers") or {}
SERVERS = {key: cfg for key, cfg in _RAW_SERVERS.items() if is_configured_server(cfg)}
_last_guard_ts = 0.0

# 可选 HTTP Basic 认证：设置密码即启用（环境变量优先于 config.json）
AUTH_USERNAME = os.environ.get("DASHBOARD_USERNAME") or str(CONFIG.get("auth_username") or "admin")
AUTH_PASSWORD = os.environ.get("DASHBOARD_PASSWORD") or str(CONFIG.get("auth_password") or "")
# 默认不发送 CORS 头（面板与 API 同源）；需要跨域时显式配置允许的 Origin
CORS_ALLOW_ORIGIN = str(CONFIG.get("cors_allow_origin") or "").strip()

OVERVIEW_TTL = 20
HISTORY_TTL = 30
# 两次强制刷新之间的最短间隔，防止匿名请求刷爆阿里云 API 配额
FORCE_REFRESH_MIN_INTERVAL = 5
POLL_INTERVAL = 12
BANDWIDTH_CACHE_TTL = 600

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("TrafficGuardService")


# ================== 阿里云 API 交互 ==================
_client_cache = {}
_client_lock = threading.Lock()


def get_aliyun_client(server_cfg):
    """复用 AcsClient（含 HTTP 连接池与 endpoint 解析缓存），避免每次调用重建。"""
    key = (server_cfg["ak"], server_cfg["sk"], server_cfg["region_id"])
    client = _client_cache.get(key)
    if client is None:
        with _client_lock:
            client = _client_cache.get(key)
            if client is None:
                client = AcsClient(*key)
                _client_cache[key] = client
    return client


def query_cdt_traffic(server_cfg):
    """查询当月 CDT 流量"""
    try:
        client = get_aliyun_client(server_cfg)
        request = CommonRequest()
        request.set_domain('cdt.aliyuncs.com')
        request.set_version('2021-08-13')
        request.set_action_name('ListCdtInternetTraffic')
        request.set_method('POST')

        response = client.do_action_with_exception(request)
        data = json.loads(response.decode('utf-8'))
        traffic_details = data.get('TrafficDetails', [])
        total_bytes = sum(d.get('Traffic', 0) for d in traffic_details)
        total_gb = round(total_bytes / (1024 ** 3), 3)

        isp = "BGP"
        product = "CBWP"
        if traffic_details:
            isp = str(traffic_details[0].get("ISPType", "bgp")).upper()
            ptd = traffic_details[0].get("ProductTrafficDetails", [])
            if ptd:
                product = str(ptd[0].get("Product", "cbwp")).upper()

        return {
            "success": True,
            "total_bytes": total_bytes,
            "total_gb": total_gb,
            "isp": isp,
            "product": product
        }
    except Exception as e:
        logger.error(f"CDT query error for {server_cfg.get('name', 'Unknown')}: {e}")
        return {
            "success": False,
            "error": str(e),
            "total_bytes": 0,
            "total_gb": 0.0,
            "isp": "BGP",
            "product": "CBWP"
        }


def query_ecs_info(server_cfg):
    """查询 ECS 实例详情与状态"""
    try:
        client = get_aliyun_client(server_cfg)
        request = DescribeInstancesRequest.DescribeInstancesRequest()
        request.set_InstanceIds([server_cfg["instance_id"]])
        response = client.do_action_with_exception(request)
        data = json.loads(response.decode('utf-8'))
        instances = data.get("Instances", {}).get("Instance", [])
        if not instances:
            return {"success": False, "status": "Unknown", "error": "Instance not found"}

        inst = instances[0]
        return {
            "success": True,
            "status": inst.get("Status", "Unknown"),
            "instance_name": server_cfg.get("name", "ECS-Node"),
            "instance_type": inst.get("InstanceType", "ecs.e-c4m1.large"),
            "cpu": inst.get("Cpu", 2),
            "memory": round(inst.get("Memory", 2048) / 1024, 1),
            "internet_bw_out": _safe_int(inst.get("InternetMaxBandwidthOut")),
            "eip_bandwidth": _safe_int((inst.get("EipAddress") or {}).get("Bandwidth")),
            "public_ips": sorted(_collect_public_ips(inst, server_cfg)),
            "os_name": "Linux",
            "creation_time": inst.get("CreationTime", ""),
            "expired_time": inst.get("ExpiredTime", "")
        }
    except Exception as e:
        logger.error(f"ECS query error for {server_cfg.get('name', 'Unknown')}: {e}")
        return {"success": False, "status": "Unknown", "error": str(e)}


def _safe_int(value):
    try:
        number = int(float(value))
        return number if number > 0 else None
    except (TypeError, ValueError):
        return None


def _collect_public_ips(inst, server_cfg):
    ips = set()
    raw_ip = str(server_cfg.get("ip") or "").strip()
    if raw_ip and "*" not in raw_ip:
        ips.add(raw_ip)
    eip = (inst.get("EipAddress") or {}).get("IpAddress")
    if eip:
        ips.add(str(eip))
    public_ip = inst.get("PublicIpAddress") or {}
    for item in public_ip.get("IpAddress") or []:
        if item:
            ips.add(str(item))
    return ips


def query_shared_bandwidth(server_cfg, public_ips):
    """CDT 机器公网带宽经常是 0，真实峰值在共享带宽包 (CBWP) 上。"""
    try:
        client = get_aliyun_client(server_cfg)
        request = CommonRequest()
        request.set_domain("vpc.aliyuncs.com")
        request.set_version("2016-04-28")
        request.set_action_name("DescribeCommonBandwidthPackages")
        request.set_method("POST")
        request.add_query_param("RegionId", server_cfg.get("region_id", "cn-hongkong"))
        request.add_query_param("PageSize", 50)
        response = client.do_action_with_exception(request)
        data = json.loads(response.decode("utf-8"))
        packages = (
            data.get("CommonBandwidthPackages", {}).get("CommonBandwidthPackage", [])
            or []
        )
        if not packages:
            return None

        matched = []
        fallback = []
        for pkg in packages:
            bw = _safe_int(pkg.get("Bandwidth"))
            if not bw:
                continue
            addrs = (
                (pkg.get("PublicIpAddresses") or {}).get("PublicIpAddresse")
                or (pkg.get("PublicIpAddresses") or {}).get("PublicIpAddress")
                or []
            )
            pkg_ips = {str(item.get("IpAddress")) for item in addrs if item.get("IpAddress")}
            if public_ips and pkg_ips.intersection(public_ips):
                matched.append(bw)
            else:
                fallback.append(bw)

        if matched:
            return max(matched)
        if len(fallback) == 1:
            return fallback[0]
        return None
    except Exception as e:
        logger.warning(f"CBWP query failed for {server_cfg.get('name', 'Unknown')}: {e}")
        return None


_bandwidth_cache = {}


def resolve_bandwidth_mbps(server_cfg, ecs):
    cfg_bw = _safe_int(server_cfg.get("bandwidth_mbps"))
    if cfg_bw:
        return cfg_bw
    ecs_bw = _safe_int(ecs.get("internet_bw_out")) or _safe_int(ecs.get("eip_bandwidth"))
    if ecs_bw:
        return ecs_bw
    # 共享带宽包几乎不变，缓存结果（包括失败）以免每轮轮询都多打一次 VPC API
    public_ips = frozenset(ecs.get("public_ips") or [])
    key = (server_cfg.get("ak"), server_cfg.get("region_id"), server_cfg.get("instance_id"), public_ips)
    now = time.monotonic()
    cached = _bandwidth_cache.get(key)
    if cached and cached[1] > now:
        return cached[0]
    value = query_shared_bandwidth(server_cfg, set(public_ips))
    _bandwidth_cache[key] = (value, now + BANDWIDTH_CACHE_TTL)
    return value


# ================== 历史日志解析 ==================
LOG_TRAFFIC_REGEX = re.compile(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ - INFO - 当月CDT流量使用: ([\d\.]+) GB')

class _LogFileState:
    """单个日志文件的增量解析状态：只读取上次之后新追加的内容。"""

    __slots__ = ("inode", "offset", "hourly", "daily")

    def __init__(self, inode):
        self.inode = inode
        self.offset = 0
        self.hourly = {}
        self.daily = {}


_log_states = {}
_log_states_lock = threading.Lock()


def _ingest_log_line(state, line):
    m = LOG_TRAFFIC_REGEX.search(line)
    if not m:
        return
    time_str, gb_str = m.groups()
    try:
        val = float(gb_str)
    except ValueError:
        return
    state.hourly[time_str[:13] + ":00"] = val
    day_key = time_str[:10]
    info = state.daily.get(day_key)
    if info is None:
        state.daily[day_key] = {"min": val, "max": val, "first": val, "last": val}
    else:
        if val > info["max"]:
            info["max"] = val
        if val < info["min"]:
            info["min"] = val
        info["last"] = val


def _read_log_incremental(log_file):
    try:
        st = os.stat(log_file)
    except OSError:
        return None
    state = _log_states.get(log_file)
    # 文件被轮转 / 截断时重新解析
    if state is None or state.inode != st.st_ino or st.st_size < state.offset:
        state = _LogFileState(st.st_ino)
        _log_states[log_file] = state
    if st.st_size == state.offset:
        return state
    try:
        with open(log_file, "rb") as f:
            f.seek(state.offset)
            chunk = f.read(st.st_size - state.offset)
    except Exception as e:
        logger.error(f"Error parsing log file {log_file}: {e}")
        return state
    # 只处理完整行，末尾未写完的半行留到下一轮
    end = chunk.rfind(b"\n") + 1
    if end <= 0:
        return state
    for line in chunk[:end].decode("utf-8", errors="ignore").splitlines():
        _ingest_log_line(state, line)
    state.offset += end
    return state


def parse_server_history(log_files):
    hourly_map = {}
    daily_map = {}

    with _log_states_lock:
        for log_file in reversed(log_files):
            state = _read_log_incremental(log_file)
            if state is None:
                continue
            hourly_map.update(state.hourly)
            for day_key, info in state.daily.items():
                merged = daily_map.get(day_key)
                if merged is None:
                    daily_map[day_key] = dict(info)
                else:
                    merged["max"] = max(merged["max"], info["max"])
                    merged["min"] = min(merged["min"], info["min"])
                    merged["last"] = info["last"]

    sorted_hours = sorted(hourly_map.keys())
    if len(sorted_hours) > 168:
        sorted_hours = sorted_hours[-168:]

    hourly_series = [{"time": k, "traffic_gb": hourly_map[k]} for k in sorted_hours]

    sorted_days = sorted(daily_map.keys())
    daily_series = []
    for i, d in enumerate(sorted_days):
        info = daily_map[d]
        if i == 0:
            delta = round(info["max"] - info["min"], 3)
        else:
            prev_day = sorted_days[i-1]
            delta = round(max(0, info["last"] - daily_map[prev_day]["last"]), 3)
        daily_series.append({
            "date": d,
            "delta_gb": max(0.0, delta),
            "cum_gb": info["last"]
        })

    return {
        "hourly": hourly_series,
        "daily": daily_series
    }


def history_log_path(s_key, s_cfg):
    files = [path for path in (s_cfg.get("log_files") or []) if path]
    if files:
        return files[0]
    os.makedirs(HISTORY_DIR, exist_ok=True)
    return os.path.join(HISTORY_DIR, f"{s_key}.log")


def append_traffic_log(s_key, s_cfg, used_gb):
    path = history_log_path(s_key, s_cfg)
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S,%f")[:23]
    line = f"{stamp} - INFO - 当月CDT流量使用: {float(used_gb):.2f} GB\n"
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(line)
    files = s_cfg.get("log_files") or []
    if path not in files:
        s_cfg["log_files"] = [path] + files


def set_instance_power(s_cfg, action):
    client = get_aliyun_client(s_cfg)
    instance_id = s_cfg["instance_id"]
    if action == "start":
        request = StartInstancesRequest.StartInstancesRequest()
    else:
        request = StopInstancesRequest.StopInstancesRequest()
        request.set_ForceStop(False)
    request.set_InstanceIds([instance_id])
    request.set_accept_format("json")
    response = client.do_action_with_exception(request)
    logger.info(
        "Guard %s %s (%s): %s",
        action,
        s_cfg.get("name", s_cfg.get("id")),
        instance_id,
        response.decode("utf-8") if isinstance(response, (bytes, bytearray)) else response,
    )


def enforce_guards(overview):
    servers = (overview or {}).get("servers") or {}
    for s_key, s_cfg in SERVERS.items():
        node = servers.get(s_key) or {}
        traffic = node.get("traffic") or {}
        name = s_cfg.get("name", s_key)
        if not traffic.get("query_ok"):
            logger.warning("Skip guard/history for %s: CDT query failed", name)
            continue
        used = float(traffic.get("used_gb") or 0)
        try:
            append_traffic_log(s_key, s_cfg, used)
        except Exception as exc:
            logger.error("Failed to append history log for %s: %s", name, exc)

        if not GUARD_ENABLED or s_cfg.get("guard_enabled") is False:
            continue
        threshold = _safe_float(s_cfg.get("threshold_gb"), 180.0)
        status = node.get("status")
        try:
            if used >= threshold:
                if status in ("Stopped", "Stopping"):
                    logger.info("Guard %s already %s (%.2f / %.0f GB)", name, status.lower(), used, threshold)
                    continue
                # 状态未知时仍尝试关机：超额风险优先
                logger.warning("Guard stop %s: %.2f GB >= %.0f GB", name, used, threshold)
                set_instance_power(s_cfg, "stop")
            elif GUARD_AUTO_START and s_cfg.get("guard_auto_start", True):
                # 只在确认已停止时开机；ECS 查询失败 (Unknown) 或处于过渡状态时不动
                if status != "Stopped":
                    continue
                logger.info("Guard start %s: %.2f GB < %.0f GB", name, used, threshold)
                set_instance_power(s_cfg, "start")
        except Exception as exc:
            logger.error("Guard action failed for %s: %s", name, exc)


# ================== 数据汇总生成 ==================
_api_pool = None
_api_pool_lock = threading.Lock()


def _get_api_pool():
    global _api_pool
    with _api_pool_lock:
        if _api_pool is None:
            workers = max(4, min(16, len(SERVERS) * 2))
            _api_pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="aliyun-api")
        return _api_pool


def _query_all_servers():
    """并发查询所有节点的 CDT / ECS / 带宽，耗时从 N×串行 降到约一次往返。"""
    if not SERVERS:
        return {}
    pool = _get_api_pool()
    cdt_futures = {k: pool.submit(query_cdt_traffic, c) for k, c in SERVERS.items()}
    ecs_futures = {k: pool.submit(query_ecs_info, c) for k, c in SERVERS.items()}
    ecs_results = {k: f.result() for k, f in ecs_futures.items()}
    bw_futures = {
        k: pool.submit(resolve_bandwidth_mbps, c, ecs_results[k]) for k, c in SERVERS.items()
    }
    return {
        k: (cdt_futures[k].result(), ecs_results[k], bw_futures[k].result())
        for k in SERVERS
    }


def _public_ecs_info(ecs):
    """对外输出时去掉真实公网 IP 与原始异常信息（可能含 AccessKeyId / RequestId）。"""
    public = {k: v for k, v in ecs.items() if k not in ("public_ips", "error")}
    if not ecs.get("success"):
        public["error"] = "ECS query failed"
    return public


def compute_overview_data():
    servers_data = {}
    combined_used_gb = 0.0
    combined_threshold_gb = 0.0

    current_dt = datetime.now()
    day_of_month = max(1, current_dt.day)
    days_in_month = calendar.monthrange(current_dt.year, current_dt.month)[1]

    results = _query_all_servers()
    for s_key, s_cfg in SERVERS.items():
        cdt, ecs, bandwidth_mbps = results[s_key]

        used_gb = cdt["total_gb"]
        threshold_gb = _safe_float(s_cfg.get("threshold_gb"), 180.0)
        remaining_gb = max(0.0, round(threshold_gb - used_gb, 3))
        pct = round((used_gb / threshold_gb) * 100, 1) if threshold_gb > 0 else 0.0

        daily_avg = round(used_gb / day_of_month, 2)
        days_left = round(remaining_gb / daily_avg, 1) if daily_avg > 0 else 999.0
        projected_month_end = round(daily_avg * days_in_month, 2)

        combined_used_gb += used_gb
        combined_threshold_gb += threshold_gb

        servers_data[s_key] = {
            "id": s_key,
            "name": s_cfg.get("name", s_key),
            "ip": s_cfg.get("masked_ip", "*.*.*.*"),
            "instance_id": s_cfg.get("instance_id", "i-xxx")[:10] + "...",
            "region_id": s_cfg.get("region_id", "cn-hongkong"),
            "region_name": "阿里云香港",
            "status": ecs.get("status", "Unknown"),
            "ecs_info": _public_ecs_info(ecs),
            "traffic": {
                "used_gb": used_gb,
                "used_bytes": cdt.get("total_bytes", 0),
                "threshold_gb": threshold_gb,
                "remaining_gb": remaining_gb,
                "percentage": pct,
                "isp": cdt.get("isp", "BGP"),
                "product": cdt.get("product", "CBWP"),
                "bandwidth_mbps": bandwidth_mbps,
                "daily_avg_gb": daily_avg,
                "days_left_est": days_left,
                "projected_month_end_gb": projected_month_end,
                "near_limit": pct >= 85.0,
                "exceeded": pct >= 100.0,
                "query_ok": bool(cdt.get("success")),
            },
            "network": {
                "online": True,
                "status": "active",
                "detail": "香港 BGP 专线"
            }
        }

    combined_pct = round((combined_used_gb / combined_threshold_gb) * 100, 1) if combined_threshold_gb > 0 else 0.0
    node_total = len(servers_data)
    running_count = sum(1 for s in servers_data.values() if s.get("status") == "Running")

    return {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "node_tag": CONFIG.get("node_tag", "Guard-Master"),
        "summary": {
            "total_used_gb": round(combined_used_gb, 3),
            "total_threshold_gb": round(combined_threshold_gb, 1),
            "total_remaining_gb": round(max(0.0, combined_threshold_gb - combined_used_gb), 3),
            "total_percentage": combined_pct,
            "nodes_online": running_count,
            "nodes_total": node_total,
            "running_count": running_count,
            "node_count_label": node_count_label(node_total)
        },
        "server_ids": list(servers_data.keys()),
        "servers": servers_data
    }


def build_server_series_meta():
    meta = []
    for idx, (s_key, s_cfg) in enumerate(SERVERS.items()):
        meta.append({
            "id": s_key,
            "name": s_cfg.get("name", s_key),
            "masked_ip": s_cfg.get("masked_ip", "*.*.*.*"),
            "color": SERIES_COLORS[idx % len(SERIES_COLORS)]
        })
    return meta


def compute_history_data():
    parsed = {}
    for s_key, s_cfg in SERVERS.items():
        logs = s_cfg.get("log_files") or [history_log_path(s_key, s_cfg)]
        parsed[s_key] = parse_server_history(logs)

    hourly_dict = {}
    for s_key, hist in parsed.items():
        for pt in hist.get("hourly", []):
            t = pt["time"]
            item = hourly_dict.setdefault(t, {"time": t, "values": {}})
            item["values"][s_key] = pt["traffic_gb"]
            item[f"{s_key}_gb"] = pt["traffic_gb"]

    merged_hourly = []
    for t in sorted(hourly_dict.keys()):
        item = hourly_dict[t]
        total = 0.0
        for s_key in SERVERS:
            val = item["values"].get(s_key)
            if val is None:
                val = 0.0
                item["values"][s_key] = 0.0
            total += val
        item["total_gb"] = round(total, 3)
        merged_hourly.append(item)

    daily_dict = {}
    for s_key, hist in parsed.items():
        for pt in hist.get("daily", []):
            d = pt["date"]
            item = daily_dict.setdefault(d, {"date": d, "values": {}, "cum_values": {}})
            item["values"][s_key] = pt["delta_gb"]
            item["cum_values"][s_key] = pt["cum_gb"]
            item[f"{s_key}_delta_gb"] = pt["delta_gb"]
            item[f"{s_key}_cum_gb"] = pt["cum_gb"]

    merged_daily = []
    for d in sorted(daily_dict.keys()):
        item = daily_dict[d]
        total = 0.0
        for s_key in SERVERS:
            val = item["values"].get(s_key)
            if val is None:
                val = 0.0
                item["values"][s_key] = 0.0
                item[f"{s_key}_delta_gb"] = 0.0
            total += val
        item["total_delta_gb"] = round(total, 3)
        merged_daily.append(item)

    now_min = datetime.now().strftime("%Y-%m-%d %H:%M")
    if merged_hourly:
        last_t = merged_hourly[-1].get("time", "")
        if last_t != now_min:
            latest_pt = {
                "time": now_min,
                "values": dict(merged_hourly[-1].get("values", {})),
                "total_gb": merged_hourly[-1].get("total_gb", 0.0)
            }
            for s_key, v in latest_pt["values"].items():
                latest_pt[f"{s_key}_gb"] = v
            merged_hourly.append(latest_pt)

    return {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "servers": build_server_series_meta(),
        "hourly": merged_hourly[-72:],
        "daily": merged_daily[-14:]
    }


# ================== 缓存层 ==================
def _json_bytes(data):
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _json_for_script(data):
    """内联到 <script> 时转义 <、>、& 与行分隔符，防止 </script> 截断导致 XSS。"""
    return (
        json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace(" ", "\\u2028")
        .replace(" ", "\\u2029")
    )


class _Payload:
    """预先序列化 + 压缩的响应体，同一份快照被多次请求时不再重复编码。"""

    __slots__ = ("body", "gzipped")

    def __init__(self, body, compress=True):
        self.body = body
        self.gzipped = gzip.compress(body, compresslevel=6) if compress and len(body) > 256 else None


class _Snapshot:
    __slots__ = ("data", "created", "payload")

    def __init__(self, data):
        self.data = data
        self.created = time.monotonic()
        self.payload = _Payload(_json_bytes(data))


class _CachedResource:
    """
    读请求直接返回内存快照；只有过期或强制刷新时才计算。
    并发的刷新请求会合并成一次计算，overview 与 history 互不阻塞。
    """

    def __init__(self, compute, ttl):
        self._compute = compute
        self._ttl = ttl
        self._lock = threading.Lock()
        self._snapshot = None

    def _fresh(self, snap, force):
        if snap is None:
            return False
        age = time.monotonic() - snap.created
        if force:
            return age < FORCE_REFRESH_MIN_INTERVAL
        return age <= self._ttl

    def get(self, force=False):
        snap = self._snapshot
        if self._fresh(snap, force):
            return snap
        with self._lock:
            snap = self._snapshot
            if self._fresh(snap, force):
                return snap
            snap = _Snapshot(self._compute())
            self._snapshot = snap
            return snap


_overview_cache = _CachedResource(lambda: compute_overview_data(), OVERVIEW_TTL)
_history_cache = _CachedResource(lambda: compute_history_data(), HISTORY_TTL)


def get_cached_overview(force=False):
    return _overview_cache.get(force).data


def get_cached_history(force=False):
    return _history_cache.get(force).data


def background_poller():
    global _last_guard_ts
    logger.info(
        "Background traffic poller started (guard=%s, interval=%ss, auto_start=%s).",
        GUARD_ENABLED,
        GUARD_INTERVAL,
        GUARD_AUTO_START,
    )
    while True:
        try:
            overview = get_cached_overview(force=True)
            now = time.time()
            if now - _last_guard_ts >= GUARD_INTERVAL:
                enforce_guards(overview)
                _last_guard_ts = now
            get_cached_history(force=True)
        except Exception as e:
            logger.error(f"Error in background poller: {e}")
        time.sleep(POLL_INTERVAL)


# ================== HTTP 服务 ==================
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf"
}
COMPRESSIBLE_EXTS = {".html", ".js", ".css", ".json", ".svg", ".ico", ".ttf"}
STATIC_ROOT = os.path.realpath(STATIC_DIR)
STATIC_CACHE_MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_REQUEST_BODY_BYTES = 64 * 1024
FALLBACK_HTML = _Payload("""<!DOCTYPE html><html><head><meta charset="utf-8"><title>流量守卫</title></head>
<body><h2>🚀 流量守卫服务启动中...</h2></body></html>""".encode("utf-8"))

_static_cache = {}
_static_cache_lock = threading.Lock()
_index_cache = {"key": None, "template": None, "payload": None}
_index_lock = threading.Lock()


def resolve_static_path(url_path):
    """把 URL 路径映射到 dashboard_dist 内的真实文件；越界（../、符号链接等）返回 None。"""
    rel = urllib.parse.unquote(url_path)
    if "\x00" in rel:
        return None
    rel = posixpath.normpath("/" + rel.replace("\\", "/")).lstrip("/")
    full = os.path.realpath(os.path.join(STATIC_ROOT, rel))
    if full != STATIC_ROOT and not full.startswith(STATIC_ROOT + os.sep):
        return None
    return full


def _load_static(file_path, st):
    key = (st.st_mtime_ns, st.st_size)
    entry = _static_cache.get(file_path)
    if entry and entry[0] == key:
        return entry[1]
    with open(file_path, "rb") as f:
        content = f.read()
    ext = os.path.splitext(file_path)[1].lower()
    payload = _Payload(content, compress=ext in COMPRESSIBLE_EXTS)
    if st.st_size <= STATIC_CACHE_MAX_FILE_BYTES:
        with _static_cache_lock:
            _static_cache[file_path] = (key, payload)
    return payload


def _index_template(html_file):
    st = os.stat(html_file)
    key = (st.st_mtime_ns, st.st_size)
    if _index_cache["template"] is None or _index_cache["template"][0] != key:
        with open(html_file, "r", encoding="utf-8") as f:
            raw_html = f.read()
        head, sep, tail = raw_html.partition("</head>")
        _index_cache["template"] = (key, (head, tail) if sep else None, raw_html)
    return _index_cache["template"]


def build_index_payload(html_file):
    overview = _overview_cache.get()
    history = _history_cache.get()
    with _index_lock:
        template = _index_template(html_file)
        cache_key = (template[0], overview, history)
        cached = _index_cache["payload"]
        if cached and cached[0] == cache_key:
            return cached[1]
        parts = template[1]
        if parts is None:
            html = template[2]
        else:
            initial_state = _json_for_script({"overview": overview.data, "history": history.data})
            html = f"{parts[0]}<script>window.__INITIAL_DATA__ = {initial_state};</script></head>{parts[1]}"
        payload = _Payload(html.encode("utf-8"))
        _index_cache["payload"] = (cache_key, payload)
        return payload


def _check_basic_auth(header_value):
    if not AUTH_PASSWORD:
        return True
    if not header_value or not header_value.startswith("Basic "):
        return False
    try:
        decoded = base64.b64decode(header_value[6:].strip(), validate=True).decode("utf-8")
    except Exception:
        return False
    username, sep, password = decoded.partition(":")
    if not sep:
        return False
    user_ok = hmac.compare_digest(username.encode("utf-8"), AUTH_USERNAME.encode("utf-8"))
    pass_ok = hmac.compare_digest(password.encode("utf-8"), AUTH_PASSWORD.encode("utf-8"))
    return user_ok and pass_ok


def _is_truthy(query, name):
    return query.get(name, ["0"])[0] in ("1", "true", "True")


class DashboardRequestHandler(BaseHTTPRequestHandler):
    # 不暴露 Python 版本；限制慢连接占用线程
    protocol_version = "HTTP/1.1"
    timeout = 30

    def version_string(self):
        return "TrafficGuard"

    def end_headers(self):
        if CORS_ALLOW_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", CORS_ALLOW_ORIGIN)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            if CORS_ALLOW_ORIGIN != "*":
                self.send_header("Vary", "Origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def _authorized(self):
        if _check_basic_auth(self.headers.get("Authorization")):
            return True
        body = b"Unauthorized"
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Traffic Guard", charset="UTF-8"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        return False

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET, HEAD, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._authorized():
            return
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/overview" or path == "/api/stats":
            self._send_payload(_overview_cache.get(force=_is_truthy(query, "force")).payload,
                               "application/json; charset=utf-8", no_cache=True)
            return

        if path == "/api/history":
            self._send_payload(_history_cache.get(force=_is_truthy(query, "force")).payload,
                               "application/json; charset=utf-8", no_cache=True)
            return

        self._serve_static(path)

    def _discard_request_body(self):
        """keep-alive 下必须读掉请求体，否则残留字节会被当成下一个请求解析。"""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_REQUEST_BODY_BYTES:
            self.close_connection = True
            return
        if length:
            self.rfile.read(length)

    def do_POST(self):
        self._discard_request_body()
        if not self._authorized():
            return
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/refresh":
            data = get_cached_overview(force=True)
            self._send_json({"success": True, "message": "Refreshed successfully", "data": data})
            return

        self.send_error(404, "Endpoint not found")

    def _send_json(self, data, code=200):
        self._send_payload(_Payload(_json_bytes(data)), "application/json; charset=utf-8",
                           code=code, no_cache=True)

    def _serve_static(self, path):
        if not os.path.isdir(STATIC_DIR):
            self._send_payload(FALLBACK_HTML, "text/html; charset=utf-8", no_cache=True)
            return

        file_path = resolve_static_path(path)
        if file_path is None or file_path in (STATIC_ROOT, os.path.join(STATIC_ROOT, "index.html")):
            self._serve_injected_index_html()
            return

        try:
            st = os.stat(file_path)
        except OSError:
            st = None
        if st is None or not os.path.isfile(file_path):
            self._serve_injected_index_html()
            return

        ext = os.path.splitext(file_path)[1].lower()
        mime_type = MIME_TYPES.get(ext, "application/octet-stream")

        try:
            payload = _load_static(file_path, st)
        except Exception as e:
            logger.error(f"Error reading static file {file_path}: {e}")
            self.send_error(500, "Error reading file")
            return
        # 只有 Vite 输出到 assets/ 的带哈希文件名才可以永久缓存
        rel = os.path.relpath(file_path, STATIC_ROOT).replace(os.sep, "/")
        self._send_payload(payload, mime_type, immutable=rel.startswith("assets/"))

    def _serve_injected_index_html(self):
        html_file = os.path.join(STATIC_DIR, "index.html")
        if not os.path.exists(html_file):
            self._send_payload(FALLBACK_HTML, "text/html; charset=utf-8", no_cache=True)
            return

        try:
            payload = build_index_payload(html_file)
        except Exception as e:
            logger.error(f"Error injecting HTML data: {e}")
            self.send_error(500, "Error serving index")
            return
        self._send_payload(payload, "text/html; charset=utf-8", no_cache=True)

    def _send_payload(self, payload, content_type, code=200, immutable=False, no_cache=False):
        accept_encoding = self.headers.get("Accept-Encoding", "")
        use_gzip = payload.gzipped is not None and "gzip" in accept_encoding
        body = payload.gzipped if use_gzip else payload.body

        self.send_response(code)
        self.send_header("Content-Type", content_type)

        if no_cache:
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        elif immutable:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")

        if payload.gzipped is not None:
            self.send_header("Vary", "Accept-Encoding")
        if use_gzip:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def log_message(self, format, *args):
        pass


def main():
    skipped = [key for key in _RAW_SERVERS if key not in SERVERS]
    logger.info(f"Starting High-Performance Traffic Guard Server on {HOST}:{PORT}")
    logger.info(f"Configured nodes: {len(SERVERS)} ({', '.join(SERVERS.keys()) or 'none'})")
    if skipped:
        logger.warning(f"Skipped placeholder / incomplete nodes: {', '.join(skipped)}")
    get_cached_overview(force=True)
    get_cached_history(force=True)

    poller = threading.Thread(target=background_poller, daemon=True)
    poller.start()

    server = ThreadingHTTPServer((HOST, PORT), DashboardRequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Service shutting down...")
        server.server_close()


if __name__ == "__main__":
    main()
