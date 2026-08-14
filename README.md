<div align="center">

# 🛡️ 阿里云 CDT 流量守卫 (Aliyun CDT Traffic Guard)

**极简、优雅、高响应速度的阿里云 CDT 流量监控可视化面板与自动化停机保护套件**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python Version](https://img.shields.io/badge/Python-3.10%2B-green.svg)](https://www.python.org/)
[![React Version](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ed.svg)](https://www.docker.com/)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GHCR%20Automated-success.svg)](https://github.com/uncat2310/aliyun-cdt-traffic-guard/actions)

*额度守护，账单无忧，全天候静默守护。*

</div>

---

## 📖 项目简介

**阿里云 CDT 流量守卫 (Aliyun CDT Traffic Guard)** 是一套专为使用阿里云云数据传输（CDT）共享额度设计的自动化流量监控与安全保护系统。

系统集成了 **SSR-Lite 毫秒级极速首屏直出**、多节点流量聚合计算、日均速率与续航天数预测、72小时走势图以及全自动超额熔断关机保护功能，助你轻松掌控多台 ECS 服务器的网络流量。

---

## ✨ 核心特性

- 🛡️ **智能额度熔断守护**：全天候定时检测名下多台 ECS 实例的当月 CDT 出网流量，达阈值自动关机保护，杜绝天价账单。
- ⚡ **SSR-Lite 极速首屏直出**：服务端首屏数据内存预热注入，首屏打开耗时 `< 80ms`，告别前端白屏与加载等待。
- 📊 **多维度精细可视化**：
  - 实时已用流量、剩余安全额度、百分比环形进度指示器。
  - 日均消耗速率估算与可用安全续航天数精准预测。
  - 72 小时平滑累积走势折线图与 14 天每日出网增量对比柱状图。
- 📱 **流体响应式布局**：针对移动端专项适配，移动设备自动切换为 2x2 精致指标网格与全宽手势图表。
- 🌓 **三模态主题引擎**：原生支持浅色明亮（Light）、极简暗黑（Dark）与跟随操作系统偏好自动切换。
- 🔒 **全链路隐私脱敏**：前端展示与后端 API 均支持 IP 前缀掩码脱敏，防止真实服务器敏感信息泄露。
- 🐳 **多架构 Docker 支持**：原生提供 `linux/amd64` 与 `linux/arm64` 多平台 Docker 镜像与一键部署编排。

---

## 🚀 快速开始

### 方式一：Docker 一键拉取运行（推荐，免环境配置）

```bash
docker run -d \
  --name aliyun-traffic-guard \
  --restart unless-stopped \
  -p 8388:8388 \
  -v $(pwd)/config.json:/app/config.json \
  ghcr.io/uncat2310/aliyun-cdt-traffic-guard:latest
```

启动后打开浏览器访问 `http://localhost:8388` 即可！

---

### 方式二：Docker Compose 一键编排

1. 克隆代码仓库：
```bash
git clone https://github.com/uncat2310/aliyun-cdt-traffic-guard.git
cd aliyun-cdt-traffic-guard
```

2. 参考 `backend/config.example.json` 创建 `config.json` 并填入阿里云 API 凭据：
```bash
cp backend/config.example.json config.json
```

3. 启动容器：
```bash
docker compose up -d
```

4. 打开浏览器访问 `http://localhost:8388`。

---

### 方式三：源码本地 / 服务器运行

#### 1. 编译前端（React 19 + Vite）
```bash
cd frontend
npm install
npm run build
cd ..
```

#### 2. 配置并运行后端服务
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp config.example.json config.json
# 编辑 config.json 填入 AccessKey 与实例 ID

python monitor_service.py
```

---

## 🛠️ 目录结构

```text
aliyun-cdt-traffic-guard/
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
├── systemd/                  # Linux Systemd 服务配置模板
│   └── traffic-monitor.service.example
├── Dockerfile                # 多阶段 Docker 构建镜像
├── docker-compose.yml        # Docker Compose 编排文件
└── README.md
```

---

## ⚙️ 配置文件说明 (`config.json`)

```json
{
  "access_key_id": "YOUR_ALIYUN_ACCESS_KEY_ID",
  "access_key_secret": "YOUR_ALIYUN_ACCESS_KEY_SECRET",
  "region_id": "cn-hongkong",
  "instances": [
    {
      "id": "i-j6cxxxxxxxxxxxxxxxxx",
      "name": "香港节点 01",
      "quota_gb": 180,
      "ip": "43.99.*.*"
    }
  ],
  "total_quota_gb": 200,
  "check_interval_seconds": 60,
  "auto_shutdown": true
}
```

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `access_key_id` | String | 阿里云 RAM 访问凭据 AccessKey ID |
| `access_key_secret` | String | 阿里云 RAM 访问凭据 AccessKey Secret |
| `region_id` | String | 实例所在地域（如 `cn-hongkong`） |
| `instances` | Array | 监控的 ECS 实例列表及各实例配额阈值 |
| `total_quota_gb` | Number | CDT 月度免费/安全共享总额度（单位：GB） |
| `auto_shutdown` | Boolean | 达到阈值时是否自动执行实例停机保护 |

---

## 🔒 隐私与安全

- **RAM 最小权限原则**：建议为本系统创建专属 RAM 子账号，仅授予 `AliyunECSReadOnlyAccess` 与 `AliyunECSFullAccess`（或针对特定实例的 `StopInstance` 权限）；
- **凭据隔离**：严禁将包含真实 `AccessKey` 的 `config.json` 提交至公开 Git 仓库。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 协议开源。
