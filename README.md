<div align="center">

# 流量守卫

阿里云 CDT 出网流量监控面板，支持 1 台到多台 ECS，带 72 小时累积趋势、14 天每日消耗，以及独立的超额停机脚本。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10%2B-green.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ed.svg)](https://www.docker.com/)

[在线 Demo](https://honkai3rd.eu.org) · [GitHub](https://github.com/uncat2310/aliyun-cdt-traffic-guard)

</div>

---

## 这是什么

给使用阿里云 **云数据传输（CDT）** 共享出网额度的机器准备的监控面板。

面板只负责看：当月已用、剩余额度、日均消耗、预计可用天数，以及 72H / 14D 走势。  
真正的超额停机由 `scripts/auto_traffic_guard.py` 按节点单独跑，不和面板绑死。

假数据 Demo：<https://honkai3rd.eu.org>（备用 <https://demo.as4837.de>）

- [1 台](https://honkai3rd.eu.org/?nodes=1)
- [3 台](https://honkai3rd.eu.org/?nodes=3)
- [5 台](https://honkai3rd.eu.org/?nodes=5)

Demo 里的数字是虚构的，用来看布局和图表，不会连你的阿里云账号。

---

## 功能

- **N 台节点**：`config.json` 里有几台，面板就显示几台。1 台用 Hero Card，多台用紧凑卡片；5 台是 3+2 居中。
- **首屏直出**：后端把 overview / history 注入 `window.__INITIAL_DATA__`，打开页面不用先白屏再拉接口。
- **72H 累积趋势**：折线 + 浅面积，整数 Y 轴，终点显示当前值，Hover 看历史时刻。
- **14D 每日消耗**：分组柱状图，整数 nice ticks，按天对比各节点。
- **浅色 / 深色 / 跟随系统**
- **IP 脱敏**：面板只展示掩码 IP。
- **占位节点自动忽略**：示例里没改完的 `YOUR_ALIYUN_*` / `i-xxxxxxxx` 不会当成真机器画出来。

---

## 快速开始

### Docker

```bash
cp backend/config.example.json config.json
# 编辑 config.json，填入 AccessKey 和实例 ID

docker run -d \
  --name aliyun-traffic-guard \
  --restart unless-stopped \
  -p 8388:8388 \
  -v "$(pwd)/config.json:/app/config.json" \
  ghcr.io/uncat2310/aliyun-cdt-traffic-guard:latest
```

浏览器打开 <http://localhost:8388>。

### Docker Compose

```bash
git clone https://github.com/uncat2310/aliyun-cdt-traffic-guard.git
cd aliyun-cdt-traffic-guard
cp backend/config.example.json config.json
# 编辑 config.json

docker compose up -d
```

### 源码运行

```bash
cd frontend
npm install
npm run build
cd ../backend

python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp config.example.json config.json
# 编辑 config.json

python monitor_service.py
```

后端会读取同目录下的 `dashboard_dist`。Docker 镜像构建时已经把前端产物拷进去；源码运行需要自己把 `frontend/dist` 拷成 `backend/dashboard_dist`：

```bash
cp -R frontend/dist backend/dashboard_dist
```

Windows PowerShell：

```powershell
Copy-Item -Recurse frontend\dist backend\dashboard_dist
```

### 本地假数据 Demo

不需要阿里云密钥：

```bash
cd frontend
npm install
npm run build
cd ..
python scripts/demo_server.py
```

然后打开：

- <http://127.0.0.1:8388/?nodes=1>
- <http://127.0.0.1:8388/?nodes=3>
- <http://127.0.0.1:8388/?nodes=5>

---

## 配置

复制 `backend/config.example.json` 为 `config.json`。  
**只有一台机器时，`servers` 里只留一个节点。**

```json
{
  "host": "0.0.0.0",
  "port": 8388,
  "node_tag": "Guard-Master",
  "servers": {
    "server1": {
      "id": "server1",
      "name": "香港节点 01",
      "masked_ip": "43.99.*.*",
      "ip": "43.99.0.1",
      "instance_id": "i-j6cxxxxxxxxxxxxxxxxx",
      "region_id": "cn-hongkong",
      "ak": "YOUR_ALIYUN_ACCESS_KEY_ID",
      "sk": "YOUR_ALIYUN_ACCESS_KEY_SECRET",
      "threshold_gb": 180.0,
      "bandwidth_mbps": 0,
      "log_files": ["/opt/auto/auto1.log"]
    }
  }
}
```

多机就在 `servers` 里继续加 `server2`、`server3`，key 可以自定义。

| 字段 | 说明 |
| --- | --- |
| `host` / `port` | 面板监听地址 |
| `servers.<id>.ak` / `sk` | 该节点阿里云 AccessKey |
| `servers.<id>.instance_id` | ECS 实例 ID |
| `servers.<id>.region_id` | 地域，例如 `cn-hongkong` |
| `servers.<id>.threshold_gb` | 该节点月度安全额度（GB） |
| `servers.<id>.bandwidth_mbps` | `0` 表示自动探测；面板本身不再展示带宽 |
| `servers.<id>.log_files` | 守卫脚本日志，用来画 72H / 14D |

独立停机脚本：`scripts/auto_traffic_guard.py`，每台机器跑一份即可。

---

## 目录

```text
aliyun-cdt-traffic-guard/
├── backend/                     # 面板 HTTP 服务与阿里云查询
│   ├── config.example.json
│   ├── monitor_service.py
│   └── requirements.txt
├── frontend/                    # React 19 + Vite 面板
├── scripts/
│   ├── auto_traffic_guard.py    # 超额停机脚本
│   └── demo_server.py           # 假数据 Demo
├── systemd/                     # systemd 模板
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 权限与安全

建议单独建 RAM 子账号，只给读流量 / 读实例，以及（如果要用停机脚本）对应实例的 `StopInstance`。

**不要把带真实 AccessKey 的 `config.json` 提交到 Git。**

---

## License

[MIT](LICENSE)
