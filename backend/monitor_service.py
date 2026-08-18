#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Alibaba Cloud CDT Traffic Guard & Monitoring Dashboard Service
High-Performance SSR-Lite & In-Memory Pre-Warming Server
"""

import os
import re
import sys
import json
import time
import gzip
import logging
import threading
from datetime import datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
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

_cache = {
    "overview_timestamp": 0,
    "overview_data": None,
    "history_timestamp": 0,
    "history_data": None
}
_cache_lock = threading.Lock()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("TrafficGuardService")


# ================== 阿里云 API 交互 ==================
def get_aliyun_client(server_cfg):
    return AcsClient(server_cfg["ak"], server_cfg["sk"], server_cfg["region_id"])


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


def resolve_bandwidth_mbps(server_cfg, ecs):
    cfg_bw = _safe_int(server_cfg.get("bandwidth_mbps"))
    if cfg_bw:
        return cfg_bw
    ecs_bw = _safe_int(ecs.get("internet_bw_out")) or _safe_int(ecs.get("eip_bandwidth"))
    if ecs_bw:
        return ecs_bw
    return query_shared_bandwidth(server_cfg, set(ecs.get("public_ips") or []))


# ================== 历史日志解析 ==================
LOG_TRAFFIC_REGEX = re.compile(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ - INFO - 当月CDT流量使用: ([\d\.]+) GB')

def parse_server_history(log_files):
    hourly_map = {}
    daily_map = {}

    for log_file in reversed(log_files):
        if not os.path.exists(log_file):
            continue
        try:
            with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    m = LOG_TRAFFIC_REGEX.search(line)
                    if m:
                        time_str, gb_str = m.groups()
                        val = float(gb_str)
                        hour_key = time_str[:13] + ":00"
                        day_key = time_str[:10]
                        hourly_map[hour_key] = val
                        if day_key not in daily_map:
                            daily_map[day_key] = {"min": val, "max": val, "first": val, "last": val}
                        else:
                            daily_map[day_key]["max"] = max(daily_map[day_key]["max"], val)
                            daily_map[day_key]["min"] = min(daily_map[day_key]["min"], val)
                            daily_map[day_key]["last"] = val
        except Exception as e:
            logger.error(f"Error parsing log file {log_file}: {e}")

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
        threshold = float(s_cfg.get("threshold_gb", 180.0))
        status = node.get("status")
        try:
            if used >= threshold:
                if status == "Stopped":
                    logger.info("Guard %s already stopped (%.2f / %.0f GB)", name, used, threshold)
                    continue
                logger.warning("Guard stop %s: %.2f GB >= %.0f GB", name, used, threshold)
                set_instance_power(s_cfg, "stop")
            elif GUARD_AUTO_START and s_cfg.get("guard_auto_start", True):
                if status == "Running":
                    continue
                logger.info("Guard start %s: %.2f GB < %.0f GB", name, used, threshold)
                set_instance_power(s_cfg, "start")
        except Exception as exc:
            logger.error("Guard action failed for %s: %s", name, exc)


# ================== 数据汇总生成 ==================
def compute_overview_data():
    servers_data = {}
    combined_used_gb = 0.0
    combined_threshold_gb = 0.0

    current_dt = datetime.now()
    day_of_month = max(1, current_dt.day)
    days_in_month = 31

    for s_key, s_cfg in SERVERS.items():
        cdt = query_cdt_traffic(s_cfg)
        ecs = query_ecs_info(s_cfg)

        used_gb = cdt["total_gb"]
        threshold_gb = s_cfg.get("threshold_gb", 180.0)
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
            "ecs_info": ecs,
            "traffic": {
                "used_gb": used_gb,
                "used_bytes": cdt.get("total_bytes", 0),
                "threshold_gb": threshold_gb,
                "remaining_gb": remaining_gb,
                "percentage": pct,
                "isp": cdt.get("isp", "BGP"),
                "product": cdt.get("product", "CBWP"),
                "bandwidth_mbps": resolve_bandwidth_mbps(s_cfg, ecs),
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

    return {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "servers": build_server_series_meta(),
        "hourly": merged_hourly[-72:],
        "daily": merged_daily[-14:]
    }


def get_cached_overview(force=False):
    global _cache
    with _cache_lock:
        now = time.time()
        if force or not _cache["overview_data"] or (now - _cache["overview_timestamp"] > 20):
            _cache["overview_data"] = compute_overview_data()
            _cache["overview_timestamp"] = now
        return _cache["overview_data"]


def get_cached_history(force=False):
    global _cache
    with _cache_lock:
        now = time.time()
        if force or not _cache["history_data"] or (now - _cache["history_timestamp"] > 30):
            _cache["history_data"] = compute_history_data()
            _cache["history_timestamp"] = now
        return _cache["history_data"]


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
        time.sleep(12)


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

class DashboardRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/overview" or path == "/api/stats":
            force = query.get("force", ["0"])[0] in ["1", "true", "True"]
            data = get_cached_overview(force=force)
            self._send_json(data)
            return

        if path == "/api/history":
            force = query.get("force", ["0"])[0] in ["1", "true", "True"]
            data = get_cached_history(force=force)
            self._send_json(data)
            return

        self._serve_static(path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/refresh":
            data = get_cached_overview(force=True)
            self._send_json({"success": True, "message": "Refreshed successfully", "data": data})
            return

        self.send_error(404, "Endpoint not found")

    def _send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._send_response_bytes(body, "application/json; charset=utf-8", code=code, no_cache=True)

    def _serve_static(self, path):
        if not os.path.exists(STATIC_DIR):
            self._send_fallback_html()
            return

        clean_path = path.lstrip("/")
        if not clean_path or clean_path == "index.html":
            self._serve_injected_index_html()
            return

        file_path = os.path.join(STATIC_DIR, clean_path)

        if not os.path.exists(file_path) or os.path.isdir(file_path):
            self._serve_injected_index_html()
            return

        ext = os.path.splitext(file_path)[1].lower()
        mime_type = MIME_TYPES.get(ext, "application/octet-stream")

        try:
            with open(file_path, "rb") as f:
                content = f.read()
            is_immutable = ext in [".js", ".css", ".png", ".svg", ".ico", ".woff2"]
            self._send_response_bytes(content, mime_type, immutable=is_immutable)
        except Exception as e:
            self.send_error(500, f"Error reading file: {e}")

    def _serve_injected_index_html(self):
        html_file = os.path.join(STATIC_DIR, "index.html")
        if not os.path.exists(html_file):
            self._send_fallback_html()
            return

        try:
            with open(html_file, "r", encoding="utf-8") as f:
                raw_html = f.read()

            overview_data = get_cached_overview()
            history_data = get_cached_history()

            initial_state = {
                "overview": overview_data,
                "history": history_data
            }
            script_tag = f"<script>window.__INITIAL_DATA__ = {json.dumps(initial_state, ensure_ascii=False)};</script></head>"
            injected_html = raw_html.replace("</head>", script_tag, 1)

            body = injected_html.encode("utf-8")
            self._send_response_bytes(body, "text/html; charset=utf-8", no_cache=True)
        except Exception as e:
            logger.error(f"Error injecting HTML data: {e}")
            self.send_error(500, f"Error serving index: {e}")

    def _send_response_bytes(self, content_bytes, content_type, code=200, immutable=False, no_cache=False):
        accept_encoding = self.headers.get("Accept-Encoding", "")
        can_gzip = "gzip" in accept_encoding and len(content_bytes) > 256

        self.send_response(code)
        self.send_header("Content-Type", content_type)

        if no_cache:
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        elif immutable:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")

        if can_gzip:
            compressed = gzip.compress(content_bytes, compresslevel=6)
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(compressed)))
            self.end_headers()
            self.wfile.write(compressed)
        else:
            self.send_header("Content-Length", str(len(content_bytes)))
            self.end_headers()
            self.wfile.write(content_bytes)

    def _send_fallback_html(self):
        html = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>流量守卫</title></head>
<body><h2>🚀 流量守卫服务启动中...</h2></body></html>"""
        self._send_response_bytes(html.encode("utf-8"), "text/html; charset=utf-8", no_cache=True)

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
