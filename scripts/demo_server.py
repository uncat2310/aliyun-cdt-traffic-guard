#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local fake-data demo for odd-count node card layouts (1 / 3 / 5)."""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(ROOT, "frontend", "dist")
HOST = os.environ.get("DEMO_HOST", "127.0.0.1")
PORT = int(os.environ.get("DEMO_PORT", "8388"))
ALLOWED_COUNTS = (1, 3, 5)
DEFAULT_COUNT = 3

COLORS = (
    "#0ea5e9",
    "#6366f1",
    "#10b981",
    "#f59e0b",
    "#f43f5e",
)

CATALOG = (
    {
        "id": "server1",
        "name": "香港节点 01",
        "ip": "43.99.*.*",
        "region_id": "cn-hongkong",
        "region_name": "阿里云香港",
        "used_gb": 44.53,
        "status": "Running",
        "cpu": 2,
        "memory": 0.5,
        "daily_avg_gb": 2.47,
    },
    {
        "id": "server2",
        "name": "香港节点 02",
        "ip": "8.210.*.*",
        "region_id": "cn-hongkong",
        "region_name": "阿里云香港",
        "used_gb": 24.01,
        "status": "Running",
        "cpu": 2,
        "memory": 0.5,
        "daily_avg_gb": 1.33,
    },
    {
        "id": "server3",
        "name": "东京节点 03",
        "ip": "47.74.*.*",
        "region_id": "ap-northeast-1",
        "region_name": "阿里云东京",
        "used_gb": 91.20,
        "status": "Running",
        "cpu": 2,
        "memory": 1.0,
        "daily_avg_gb": 5.07,
    },
    {
        "id": "server4",
        "name": "新加坡节点 04",
        "ip": "8.219.*.*",
        "region_id": "ap-southeast-1",
        "region_name": "阿里云新加坡",
        "used_gb": 12.40,
        "status": "Stopped",
        "cpu": 2,
        "memory": 0.5,
        "daily_avg_gb": 0.69,
    },
    {
        "id": "server5",
        "name": "美西节点 05",
        "ip": "47.88.*.*",
        "region_id": "us-west-1",
        "region_name": "阿里云美西",
        "used_gb": 67.80,
        "status": "Running",
        "cpu": 4,
        "memory": 2.0,
        "daily_avg_gb": 3.77,
    },
)


def clamp_count(raw, fallback=DEFAULT_COUNT):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return fallback
    return value if value in ALLOWED_COUNTS else fallback


def node_count_label(count):
    if count == 1:
        return "单机"
    if count == 2:
        return "两机"
    return f"{count}机"


def build_overview(count):
    threshold = 180.0
    servers = {}
    server_ids = []
    total_used = 0.0
    running = 0

    for item in CATALOG[:count]:
        used = float(item["used_gb"])
        remaining = max(0.0, round(threshold - used, 3))
        pct = round((used / threshold) * 100, 1)
        days_left = round(remaining / item["daily_avg_gb"], 1) if item["daily_avg_gb"] else 999.0
        if item["status"] == "Running":
            running += 1
        total_used += used
        server_ids.append(item["id"])
        servers[item["id"]] = {
            "id": item["id"],
            "name": item["name"],
            "ip": item["ip"],
            "instance_id": "i-demo......",
            "region_id": item["region_id"],
            "region_name": item["region_name"],
            "status": item["status"],
            "ecs_info": {
                "success": True,
                "status": item["status"],
                "cpu": item["cpu"],
                "memory": item["memory"],
            },
            "traffic": {
                "used_gb": used,
                "used_bytes": int(used * (1024 ** 3)),
                "threshold_gb": threshold,
                "remaining_gb": remaining,
                "percentage": pct,
                "isp": "BGP",
                "product": "CBWP",
                "bandwidth_mbps": 2000,
                "daily_avg_gb": item["daily_avg_gb"],
                "days_left_est": days_left,
                "projected_month_end_gb": round(item["daily_avg_gb"] * 31, 2),
                "near_limit": pct >= 85.0,
                "exceeded": pct >= 100.0,
            },
            "network": {
                "online": item["status"] == "Running",
                "status": "active" if item["status"] == "Running" else "offline",
                "detail": "演示 BGP 专线",
            },
        }

    total_threshold = threshold * count
    return {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "node_tag": "Demo-Guard",
        "summary": {
            "total_used_gb": round(total_used, 3),
            "total_threshold_gb": round(total_threshold, 1),
            "total_remaining_gb": round(max(0.0, total_threshold - total_used), 3),
            "total_percentage": round((total_used / total_threshold) * 100, 1) if total_threshold else 0,
            "nodes_online": running,
            "nodes_total": count,
            "running_count": running,
            "node_count_label": node_count_label(count),
        },
        "server_ids": server_ids,
        "servers": servers,
    }


def build_history(count):
    now = datetime.now().replace(minute=0, second=0, microsecond=0)
    nodes = CATALOG[:count]
    meta = []
    for idx, item in enumerate(nodes):
        meta.append({
            "id": item["id"],
            "name": item["name"],
            "masked_ip": item["ip"],
            "color": COLORS[idx % len(COLORS)],
        })

    hourly = []
    for hour in range(72, 0, -1):
        point_time = now - timedelta(hours=hour)
        values = {}
        row = {"time": point_time.strftime("%Y-%m-%d %H:00"), "values": values}
        total = 0.0
        progress = (72 - hour) / 71
        for item in nodes:
            val = round(max(1.0, item["used_gb"] * (0.62 + 0.38 * progress)), 2)
            values[item["id"]] = val
            row[f"{item['id']}_gb"] = val
            total += val
        row["total_gb"] = round(total, 3)
        hourly.append(row)

    daily = []
    for day in range(14, 0, -1):
        point_date = now.date() - timedelta(days=day)
        values = {}
        row = {"date": point_date.isoformat(), "values": values}
        total = 0.0
        for item in nodes:
            val = round(item["daily_avg_gb"] * (0.75 + ((14 - day) % 4) * 0.12), 2)
            values[item["id"]] = val
            row[f"{item['id']}_delta_gb"] = val
            total += val
        row["total_delta_gb"] = round(total, 3)
        daily.append(row)

    return {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "servers": meta,
        "hourly": hourly,
        "daily": daily,
    }


SWITCHER_HTML = """
<style>
  .demo-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    height: 46px;
    background: rgba(15, 23, 42, 0.92);
    color: #e2e8f0;
    font: 13px/1.2 Inter, system-ui, sans-serif;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    backdrop-filter: blur(12px);
  }
  .demo-bar a {
    color: #cbd5e1;
    text-decoration: none;
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid rgba(148,163,184,0.35);
  }
  .demo-bar a.active {
    background: #0ea5e9;
    border-color: #0ea5e9;
    color: #fff;
    font-weight: 700;
  }
  body { padding-top: 46px !important; }
</style>
<div class="demo-bar">
  <strong>假数据 Demo</strong>
  <span>看奇数卡片布局</span>
  <a href="/?nodes=1">1 台</a>
  <a href="/?nodes=3">3 台</a>
  <a href="/?nodes=5">5 台</a>
</div>
"""


def switcher_for(count):
    html = SWITCHER_HTML
    for option in ALLOWED_COUNTS:
        needle = f'href="/?nodes={option}"'
        if option == count:
            html = html.replace(needle, f'{needle} class="active"', 1)
    return html


class DemoHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _count_from_request(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if "nodes" in query:
            return clamp_count(query["nodes"][0])
        cookie = self.headers.get("Cookie", "")
        for part in cookie.split(";"):
            if part.strip().startswith("demo_nodes="):
                return clamp_count(part.split("=", 1)[1])
        return DEFAULT_COUNT

    def _send_json(self, data, count):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", f"demo_nodes={count}; Path=/; SameSite=Lax")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        count = self._count_from_request()

        if path in ("/api/overview", "/api/stats"):
            self._send_json(build_overview(count), count)
            return
        if path == "/api/history":
            self._send_json(build_history(count), count)
            return

        if path in ("/", "/index.html"):
            self._serve_index(count)
            return

        super().do_GET()

    def _serve_index(self, count):
        index_path = os.path.join(STATIC_DIR, "index.html")
        with open(index_path, "r", encoding="utf-8") as handle:
            html = handle.read()
        payload = {
            "overview": build_overview(count),
            "history": build_history(count),
        }
        injected = (
            "<script>try{localStorage.setItem('traffic_guard_theme','light');}catch(e){}</script>"
            f"<script>window.__INITIAL_DATA__ = {json.dumps(payload, ensure_ascii=False)};</script>"
            + switcher_for(count)
            + "</head>"
        )
        html = html.replace("</head>", injected, 1)
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", f"demo_nodes={count}; Path=/; SameSite=Lax")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print("[demo] " + (format % args))


def main():
    if not os.path.exists(os.path.join(STATIC_DIR, "index.html")):
        raise SystemExit(f"frontend dist missing: {STATIC_DIR}  (run npm run build first)")

    server = ThreadingHTTPServer((HOST, PORT), DemoHandler)
    print(f"Fake demo ready: http://{HOST}:{PORT}/?nodes=3")
    print("  1 card:  http://127.0.0.1:8388/?nodes=1")
    print("  3 cards: http://127.0.0.1:8388/?nodes=3")
    print("  5 cards: http://127.0.0.1:8388/?nodes=5")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("demo stopped")
        server.server_close()


if __name__ == "__main__":
    main()
