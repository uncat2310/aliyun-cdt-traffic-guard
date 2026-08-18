<div align="center">

# 🛡️ 流量守卫

阿里云 CDT 出网额度监控面板。看用量、画趋势，超额自动关机。

<br/>

[![在线 Demo](https://img.shields.io/badge/🖥️_在线_Demo-traffic.honkai3rd.eu.org-0ea5e9?style=for-the-badge)](https://traffic.honkai3rd.eu.org)

[![License](https://img.shields.io/github/license/uncat2310/aliyun-cdt-traffic-guard?style=flat-square)](LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/uncat2310/aliyun-cdt-traffic-guard?style=flat-square)](https://github.com/uncat2310/aliyun-cdt-traffic-guard)
[![Stars](https://img.shields.io/github/stars/uncat2310/aliyun-cdt-traffic-guard?style=flat-square)](https://github.com/uncat2310/aliyun-cdt-traffic-guard/stargazers)
[![GHCR](https://img.shields.io/github/actions/workflow/status/uncat2310/aliyun-cdt-traffic-guard/docker-publish.yml?branch=main&style=flat-square&label=GHCR)](https://github.com/uncat2310/aliyun-cdt-traffic-guard/actions)
[![Image](https://img.shields.io/badge/ghcr.io-aliyun--cdt--traffic--guard-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/uncat2310/aliyun-cdt-traffic-guard/pkgs/container/aliyun-cdt-traffic-guard)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111)](https://react.dev/)

<br/>

[![Demo](docs/images/demo.png)](https://traffic.honkai3rd.eu.org)

</div>

---

## 功能

- **实时用量**：当月已用、剩余额度、日均消耗、预计可用天数
- **趋势图**：近 72 小时累积流量、近 14 天每日消耗，支持 Hover 查看明细
- **多节点**：`config.json` 里写几台就显示几台
- **超额保护**：每 60 秒查询 CDT。达到阈值自动关机，降回阈值后可自动开机
- **浅色 / 深色**：支持跟随系统

部署在一台长期在线的机器上，通过阿里云 API 远程管理 ECS。不要装在会被关机的抢占式实例里。

---

## 部署

需要：一台长期在线的 Linux 主机、已安装并设为开机启动的 Docker、一个阿里云 RAM 子账号。

官方镜像（推送 `main` 后由 GitHub Actions 自动构建）：

`ghcr.io/uncat2310/aliyun-cdt-traffic-guard:latest`

容器一启动就会跑后端：提供网页、每 60 秒查 CDT、按阈值开关机。你不用再手动执行 Python 脚本。

`restart: unless-stopped` 的含义：容器崩溃会自动拉起；**这台主机重启后，只要 Docker 服务本身会开机启动，这个容器也会跟着起来。** Linux 上安装 Docker 后一般已经是开机自启。

---

### 1. 创建 RAM 子账号

打开 [RAM 用户](https://ram.console.aliyun.com/users)，新建用户并创建 AccessKey。授权：

- `AliyunCDTFullAccess`
- `AliyunECSFullAccess`

记下 AccessKey ID / Secret。再到 [ECS 实例列表](https://ecs.console.aliyun.com/server/region/cn-hongkong) 复制实例 ID（`i-...`）和地域 ID（香港是 `cn-hongkong`）。

---

### 2. 写 `config.json`

不管下不下载源码，都必须有一份自己的 `config.json`。容器靠它知道监控哪几台机器。

```json
{
  "host": "0.0.0.0",
  "port": 8388,
  "guard_enabled": true,
  "guard_auto_start": true,
  "guard_interval_seconds": 60,
  "servers": {
    "hk-01": {
      "id": "hk-01",
      "name": "香港节点 01",
      "masked_ip": "10.0.1.*",
      "instance_id": "i-把这里换成你的实例ID",
      "region_id": "cn-hongkong",
      "ak": "把这里换成 AccessKey ID",
      "sk": "把这里换成 AccessKey Secret",
      "threshold_gb": 180
    }
  }
}
```

| 必填 | 填什么 |
| --- | --- |
| `instance_id` | ECS 实例 ID |
| `region_id` | 实例地域，香港是 `cn-hongkong` |
| `ak` / `sk` | 上一步的 AccessKey |
| `threshold_gb` | 月度安全额度（GB），常用 `180` |
| `name` | 面板上显示的名称 |

多台：在 `servers` 里再加一段，换 key（如 `hk-02`）和对应实例 ID。每台可以用不同账号的 Key。只有一台时只留一个节点。

`config.json` 含密钥，不要提交到 Git。

---

### 3. 选一种方式启动

#### 方式 A：已经把代码放到本地（推荐）

仓库里自带 `docker-compose.yml`，不用手写。进入项目根目录，把配置复制到**和 yml 同一层**：

```bash
cd aliyun-cdt-traffic-guard
cp backend/config.example.json config.json
# 按上一节改 config.json
docker compose up -d
```

目录应是：

```text
aliyun-cdt-traffic-guard/          ← 在这一层执行 docker compose
├── docker-compose.yml             ← 仓库自带
├── config.json                    ← 你复制并改过的
├── history/                       ← 第一次启动后自动出现，存流量历史
├── backend/
│   └── config.example.json        ← 模板，不要拿它当正式配置
├── frontend/
└── Dockerfile
```

`docker-compose.yml` 会做这些事：

- 拉取 `ghcr.io/uncat2310/aliyun-cdt-traffic-guard:latest`
- 把当前目录的 `config.json` 挂进容器
- 映射本机 `8388` 端口
- `restart: unless-stopped`，主机重启后自动再起

打开 `http://这台机器的IP:8388`。

```bash
docker compose logs -f                         # 看日志
docker compose pull && docker compose up -d    # 更新镜像
docker compose down                            # 停止
```

本地构建而不是拉镜像：`docker compose up -d --build`。

#### 方式 B：自己建一个空文件夹，只跑 Docker

不下载源码也可以。自己建目录，只放配置：

```bash
mkdir -p ~/traffic-guard/history
cd ~/traffic-guard
```

把上一节的 JSON 存成这个目录里的 `config.json`。目录是：

```text
traffic-guard/                 ← 你自己建的
├── config.json                ← 必填，自己新建
└── history/                   ← 建议先建好，用来存图表历史
```

然后：

```bash
docker pull ghcr.io/uncat2310/aliyun-cdt-traffic-guard:latest
docker run -d \
  --name aliyun-traffic-guard \
  --restart unless-stopped \
  -p 8388:8388 \
  -v "$PWD/config.json:/app/config.json:ro" \
  -v "$PWD/history:/app/history" \
  ghcr.io/uncat2310/aliyun-cdt-traffic-guard:latest
```

同样打开 `http://这台机器的IP:8388`。`--restart unless-stopped` 和 Compose 里的作用一样：主机重启后，容器会跟着 Docker 再起来。

拉镜像失败时：

```bash
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

若 GHCR 包还是私有，到仓库 **Packages** 里把 `aliyun-cdt-traffic-guard` 设为 Public。

---

## 配置项

| 字段 | 含义 |
| --- | --- |
| `guard_enabled` | 是否自动开关机 |
| `guard_auto_start` | 低于阈值时是否自动开机 |
| `guard_interval_seconds` | 检查间隔，默认 60 秒 |
| `servers.<id>.threshold_gb` | 该节点关机阈值（GB） |

---

## 源码运行

```bash
cd frontend && npm install && npm run build && cd ..
cp -R frontend/dist backend/dashboard_dist
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.json
python monitor_service.py
```

---

<div align="center">

[在线 Demo](https://traffic.honkai3rd.eu.org) · [MIT License](LICENSE)

</div>
