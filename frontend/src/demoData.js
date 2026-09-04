// 高仿真演示数据，用于本地部署/开发预览或未配置云端密钥时的无缝展示
export const getDemoOverview = () => ({
  timestamp: new Date().toLocaleTimeString(),
  node_tag: "Guard-Local-Demo",
  summary: {
    total_used_gb: 145.25,
    total_threshold_gb: 360.0,
    total_remaining_gb: 214.75,
    total_percentage: 40.3,
    nodes_online: 2,
    nodes_total: 2,
    running_count: 2,
    node_count_label: "两机"
  },
  server_ids: ["server1", "server2"],
  servers: {
    server1: {
      id: "server1",
      name: "香港生产节点 01",
      ip: "47.242.*.*",
      instance_id: "i-j6c03j9a8...",
      region_id: "cn-hongkong",
      region_name: "阿里云香港",
      status: "Running",
      traffic: {
        used_gb: 108.45,
        threshold_gb: 180.0,
        remaining_gb: 71.55,
        percentage: 60.3,
        isp: "BGP 优质多线",
        daily_avg_gb: 4.35,
        days_left_est: 16.4,
        near_limit: false,
        exceeded: false,
        query_ok: true
      }
    },
    server2: {
      id: "server2",
      name: "香港备用节点 02",
      ip: "8.210.*.*",
      instance_id: "i-j6c78x12m...",
      region_id: "cn-hongkong",
      region_name: "阿里云香港",
      status: "Running",
      traffic: {
        used_gb: 36.80,
        threshold_gb: 180.0,
        remaining_gb: 143.20,
        percentage: 20.4,
        isp: "BGP 优质多线",
        daily_avg_gb: 1.48,
        days_left_est: 96.8,
        near_limit: false,
        exceeded: false,
        query_ok: true
      }
    }
  }
});

export const DEMO_OVERVIEW = getDemoOverview();

export const getDemoHistory = () => {
  const now = new Date();
  const formatTimeStr = (d) => {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day} ${h}:${min}`;
  };

  return {
    timestamp: now.toLocaleTimeString(),
    servers: [
      { id: "server1", name: "香港生产节点 01", masked_ip: "47.242.*.*", color: "#38bdf8" },
      { id: "server2", name: "香港备用节点 02", masked_ip: "8.210.*.*", color: "#818cf8" }
    ],
    // 以当前时间为终点，向前划分 24 小时（共 25 个按小时采样的点，精确到分钟）
    hourly: Array.from({ length: 25 }).map((_, i) => {
      const d = new Date(now.getTime() - (24 - i) * 3600 * 1000);
      const timeStr = formatTimeStr(d);
      const s1 = +(98 + (i * 0.42) + Math.sin(i * 0.8) * 0.4).toFixed(2);
      const s2 = +(32 + (i * 0.20) + Math.cos(i * 0.7) * 0.2).toFixed(2);
      return {
        time: timeStr,
        values: { server1: s1, server2: s2 },
        server1_gb: s1,
        server2_gb: s2,
        total_gb: +(s1 + s2).toFixed(2)
      };
    }),
    daily: Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(now.getTime() - (6 - i) * 24 * 3600 * 1000);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const s1Delta = +(3.8 + Math.sin(i * 1.1) * 1.2).toFixed(2);
      const s2Delta = +(1.2 + Math.cos(i * 0.9) * 0.5).toFixed(2);
      return {
        date: dateStr,
        values: { server1: s1Delta, server2: s2Delta },
        server1_delta_gb: s1Delta,
        server2_delta_gb: s2Delta,
        total_delta_gb: +(s1Delta + s2Delta).toFixed(2)
      };
    })
  };
};

export const DEMO_HISTORY = getDemoHistory();
