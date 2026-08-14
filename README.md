# 🛡️ 阿里云 CDT 流量守卫 (Aliyun CDT Traffic Guard)

> 一套轻量级、高颜值、极速响应的阿里云 CDT 流量监控可视化面板与自动化停机保护套件。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python: 3.8+](https://img.shields.io/badge/Python-3.8+-green.svg)](https://www.python.org/)
[![React: 19](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)
[![Vite: 8](https://img.shields.io/badge/Vite-8-purple.svg)](https://vitejs.dev/)

---

## ✨ 核心特性

- 🛡️ **自动化额度守护**：定时检测多台 ECS 实例的当月 CDT 流量消耗，超额自动执行关机保护，避免产生高额账单。
- ⚡ **SSR-Lite 极速秒开**：服务端首屏数据直出注入 + 后台内存守护预热，页面打开耗时 < 100ms，告别白屏与瀑布流等待。
- 📱 **移动端 & 桌面端自适应**：
  - 移动端自动优化为 2x2 指标网格与宽屏专用坐标系图表。
  - 桌面端具备 4 栏横向指标、对称卡片与高清 72H/14D 趋势图。
- 📊 **多维度流量可视化**：
  - 实时已用量、剩余安全额度、百分比圆形进度环。
  - 日均消耗速率估算与可用续航天数预测。
  - 72 小时累积走势折线图与 14 天每日增量对比柱状图。
- 🌓 **三模态主题引擎**：支持浅色模式 (Light)、深色模式 (Dark) 以及跟随系统 (System Auto)，带动态系统偏好监听。
- 🔒 **全链路隐私脱敏**：前端展示与后端 API 均支持 IP 前缀掩码脱敏，防止敏感服务器信息暴露。

---

## 📁 目录结构

```text
.
├── backend/                  # Python 后端服务 (SSR-Lite & API 守护进程)
│   ├── config.example.json   # 配置文件模板
│   ├── monitor_service.py    # 高性能 HTTP 守护服务
│   └── requirements.txt      # Python 依赖清单
├── frontend/                 # 前端监控面板源码 (React 19 + Vite)
│   ├── public/               # 静态资源与矢量 Favicon
│   ├── src/                  # React UI 组件与样式
│   ├── index.html            # SPA 入口文件
│   └── package.json          # Node 依赖配置
├── scripts/                  # 独立 Crontab 定时检测脚本
│   └── auto_traffic_guard.py # 单机独立流量守卫脚本
└── systemd/                  # Linux Systemd 服务配置模板
    └── traffic-monitor.service.example
```

---

## 🚀 快速开始

### 1. 部署后台监控服务

```bash
# 1. 进入 backend 目录并创建虚拟环境
cd backend
python3 -m venv .venv
source .venv/bin/activate

# 2. 安装依赖
pip install -r requirements.txt

# 3. 复制配置文件并填入阿里云凭证与 ECS 实例信息
cp config.example.json config.json
nano config.json
```

**`config.json` 配置示例**：
```json
{
  "host": "0.0.0.0",
  "port": 8388,
  "node_tag": "Guard-Master",
  "servers": {
    "server1": {
      "id": "server1",
      "name": "香港节点 01",
      "masked_ip": "1.2.*.*",
      "ip": "1.2.3.4",
      "instance_id": "i-j6cxxxxxxxxxxxxxxxxx",
      "region_id": "cn-hongkong",
      "ak": "YOUR_ACCESS_KEY_ID",
      "sk": "YOUR_ACCESS_KEY_SECRET",
      "threshold_gb": 180.0,
      "bandwidth_mbps": 2000,
      "log_files": ["/opt/auto/auto1.log"]
    }
  }
}
```

---

### 2. 构建前端静态资源

```bash
cd frontend
npm install
npm run build

# 构建产物默认输出至 frontend/dist，将其软链接或复制到 backend/dashboard_dist
cp -r dist ../backend/dashboard_dist
```

---

### 3. 启动服务

```bash
cd ../backend
python3 monitor_service.py
```

访问 `http://localhost:8388` 即可查看到监控面板。

---

### 4. 配置 Systemd 后台常驻守护

```bash
# 复制 systemd 模板
sudo cp systemd/traffic-monitor.service.example /etc/systemd/system/traffic-monitor.service

# 根据实际路径编辑工作目录与 Python 解释器路径
sudo nano /etc/systemd/system/traffic-monitor.service

# 启动并设置开机自启
sudo systemctl daemon-reload
sudo systemctl enable --now traffic-monitor
```

---

### 5. (可选) 配置单机 Crontab 独立检测脚本

如需在被监控机或主控机上通过 Linux Crontab 进行定时检测与自动停机：

```bash
# 编辑定时任务 (每分钟执行一次检测)
crontab -e

# 添加如下规则：
* * * * * /opt/traffic_guard/.venv/bin/python3 /opt/traffic_guard/scripts/auto_traffic_guard.py >> /var/log/traffic_guard_cron.log 2>&1
```

---

## 🛠️ API 接口说明

| 接口 | 方法 | 描述 |
| :--- | :--- | :--- |
| `/api/overview` | `GET` | 获取当前所有节点实时用量、剩余额度及 ECS 运行状态 |
| `/api/history` | `GET` | 获取最近 72 小时累积走势与最近 14 天每日流量增量 |
| `/api/refresh` | `POST` | 强制刷新阿里云 CDT 实时数据并更新内存缓存 |

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 协议开源。
