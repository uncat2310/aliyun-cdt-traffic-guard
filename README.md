<div align="center">

# 🛡️ 流量守卫

**一份配置，同时看流量、超额自动关机。**

专为阿里云 CDT 出网额度设计。跑在一台一直在线的机器上，远程守护 1 台或多台抢占式 ECS。

<br/>

[![Live Demo](https://img.shields.io/badge/Demo-在线预览-0ea5e9?style=for-the-badge&logo=googlechrome&logoColor=white)](https://honkai3rd.eu.org)
[![GitHub](https://img.shields.io/badge/GitHub-uncat2310-111827?style=for-the-badge&logo=github)](https://github.com/uncat2310/aliyun-cdt-traffic-guard)

<br/>

[![License](https://img.shields.io/github/license/uncat2310/aliyun-cdt-traffic-guard?style=flat-square&color=blue)](LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/uncat2310/aliyun-cdt-traffic-guard?style=flat-square&color=10b981)](https://github.com/uncat2310/aliyun-cdt-traffic-guard/commits/main)
[![Stars](https://img.shields.io/github/stars/uncat2310/aliyun-cdt-traffic-guard?style=flat-square&logo=github)](https://github.com/uncat2310/aliyun-cdt-traffic-guard/stargazers)
[![Docker](https://img.shields.io/github/actions/workflow/status/uncat2310/aliyun-cdt-traffic-guard/docker-publish.yml?style=flat-square&label=GHCR&logo=githubactions&logoColor=white)](https://github.com/uncat2310/aliyun-cdt-traffic-guard/actions)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111827)](https://react.dev/)
[![Visitors](https://visitor-badge.laobi.icu/badge?page_id=uncat2310.aliyun-cdt-traffic-guard)](https://github.com/uncat2310/aliyun-cdt-traffic-guard)

</div>

---

## 在线 Demo

假数据，只用来看界面。不会连接你的阿里云。

| 1 台 | 3 台 | 5 台 |
| :---: | :---: | :---: |
| [打开](https://honkai3rd.eu.org/?nodes=1) | [打开](https://honkai3rd.eu.org/?nodes=3) | [打开](https://honkai3rd.eu.org/?nodes=5) |

---

## 它做什么

同一个进程、同一份 `config.json`：

| | |
| --- | --- |
| 🖥️ **看板** | 当月已用、剩余额度、日均、预计可用天数；72H 累积趋势、14D 每日消耗 |
| 🛑 **守卫** | 每 60 秒查一次 CDT。达到阈值关机，降回去可自动开机 |
| 📈 **历史** | 服务自己写日志，图表不依赖外部 crontab |

不需要再单独挂 `auto1.py`。

> 请把本服务部署在**一直在线**的机器上（独立服务器 / 家用 NAS / 另一台包年云主机），去远程管那些抢占式实例。不要装在抢占式自己里面。

---

## 5 分钟部署

### 1. 准备 RAM

单独建一个子账号，授予：

- `AliyunCDTFullAccess`
- `AliyunECSFullAccess`

记下 AccessKey ID / Secret，以及要守护的 ECS 实例 ID。

### 2. 写配置

```bash
git clone https://github.com/uncat2310/aliyun-cdt-traffic-guard.git
cd aliyun-cdt-traffic-guard
cp backend/config.example.json config.json
```

编辑 `config.json`，至少改这三项：

```json
"instance_id": "i-xxxxxxxxxxxxxxxxx",
"ak": "你的 AccessKey ID",
"sk": "你的 AccessKey Secret"
```

一台机器只留一个 `servers` 节点。多台就复制 `server2`、`server3`。

### 3. 启动

```bash
docker compose up -d
```

打开 [http://localhost:8388](http://localhost:8388)。

开机自启由 Docker `restart: unless-stopped` 负责。用 systemd 跑源码时，把服务 `enable` 即可。

---

## 配置说明

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `guard_enabled` | `true` | 是否自动开关机 |
| `guard_auto_start` | `true` | 未超额时是否自动开机 |
| `guard_interval_seconds` | `60` | 检查间隔（秒） |
| `servers.<id>.region_id` | `cn-hongkong` | 实例地域 |
| `servers.<id>.threshold_gb` | `180` | 该节点月度安全额度 |
| `servers.<id>.log_files` | 空 | 留空则写到 `history/<id>.log` |

判定和常见 CDT 教程脚本相同：查 `ListCdtInternetTraffic`，总量 ≥ 阈值就停，否则开。查询失败这一轮不动机器。

**不要把带真实密钥的 `config.json` 提交到 Git。**

---

## 源码运行（可选）

```bash
cd frontend && npm install && npm run build && cd ..
cp -R frontend/dist backend/dashboard_dist
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.json   # 填密钥
python monitor_service.py
```

---

<div align="center">

[MIT License](LICENSE) · [在线 Demo](https://honkai3rd.eu.org) · [Issues](https://github.com/uncat2310/aliyun-cdt-traffic-guard/issues)

</div>
