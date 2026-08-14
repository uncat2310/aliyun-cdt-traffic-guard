import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  ShieldCheck,
  RefreshCw,
  Sun,
  Moon,
  Laptop,
  Check,
  TrendingUp,
  Clock,
  HardDrive,
  Cpu,
  Wifi,
  ChevronDown
} from 'lucide-react';

const API_BASE = window.location.origin;

const formatNum = (num, digits = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '0.00';
  return Number(num).toFixed(digits);
};

// 紧凑型圆形仪表盘
const CircularGauge = ({ used = 0, total = 180, percentage = 0 }) => {
  const radius = 38;
  const stroke = 7;
  const normalizedRadius = radius - stroke / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (Math.min(percentage, 100) / 100) * circumference;

  let strokeColor = '#10b981';
  if (percentage >= 85) strokeColor = '#f43f5e';
  else if (percentage >= 65) strokeColor = '#f59e0b';

  return (
    <div className="gauge-circle-container">
      <svg height={radius * 2} width={radius * 2} viewBox={`0 0 ${radius * 2} ${radius * 2}`}>
        <circle
          className="gauge-bg"
          strokeWidth={stroke}
          fill="transparent"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          className="gauge-progress"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          fill="transparent"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
      </svg>
      <div className="gauge-text-center">
        <div className="gauge-val-pct">{formatNum(percentage, 1)}%</div>
        <div className="gauge-sublabel">已用</div>
      </div>
    </div>
  );
};

// 移动端与桌面端自适应图表组件
const ResponsiveTrafficCharts = ({ historyData }) => {
  const [activeTab, setActiveTab] = useState('hourly');
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!historyData || (!historyData.hourly?.length && !historyData.daily?.length)) {
    return null;
  }

  const hourly = historyData.hourly || [];
  const rawMaxH = Math.max(5, ...hourly.map(d => Math.max(d.server1_gb || 0, d.server2_gb || 0))) * 1.15;
  const maxHourlyVal = Math.ceil(rawMaxH);

  const daily = historyData.daily || [];
  const rawMaxD = Math.max(0.5, ...daily.map(d => Math.max(d.server1_delta_gb || 0, d.server2_delta_gb || 0))) * 1.25;
  const maxDailyVal = Math.ceil(rawMaxD * 10) / 10;

  const chartWidth = isMobile ? 540 : 860;
  const chartHeight = isMobile ? 210 : 190;
  const padLeft = isMobile ? 48 : 58;
  const padRight = isMobile ? 16 : 24;
  const padTop = 16;
  const padBottom = isMobile ? 36 : 32;

  const graphW = chartWidth - padLeft - padRight;
  const graphH = chartHeight - padTop - padBottom;
  const baselineY = padTop + graphH;

  const getLinePath = (key) => {
    if (hourly.length === 0) return '';
    return hourly.reduce((acc, pt, idx) => {
      const x = padLeft + (idx / (hourly.length - 1 || 1)) * graphW;
      const val = pt[key] || 0;
      const y = padTop + graphH - (val / maxHourlyVal) * graphH;
      return `${acc} ${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }, '');
  };

  const s1Path = getLinePath('server1_gb');
  const s2Path = getLinePath('server2_gb');

  const lastIdx = hourly.length - 1;
  const lastX = padLeft + graphW;
  const s1LastY = padTop + graphH - ((hourly[lastIdx]?.server1_gb || 0) / maxHourlyVal) * graphH;
  const s2LastY = padTop + graphH - ((hourly[lastIdx]?.server2_gb || 0) / maxHourlyVal) * graphH;

  return (
    <div className="analytics-section">
      <div className="section-header">
        <div className="section-title">
          <TrendingUp size={17} style={{ color: '#0ea5e9' }} />
          <span>流量动态与趋势分析</span>
        </div>
        <div className="tab-group">
          <button
            className={`tab-btn ${activeTab === 'hourly' ? 'active' : ''}`}
            onClick={() => setActiveTab('hourly')}
          >
            72H 累积走势
          </button>
          <button
            className={`tab-btn ${activeTab === 'daily' ? 'active' : ''}`}
            onClick={() => setActiveTab('daily')}
          >
            14D 每日消耗
          </button>
        </div>
      </div>

      <div className="chart-legend-subrow">
        <div className="legend-item">
          <span className="legend-dot s1"></span>
          <span>香港节点 01 (43.99.*.*)</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot s2"></span>
          <span>香港节点 02 (8.210.*.*)</span>
        </div>
      </div>

      <div className="chart-container">
        {activeTab === 'hourly' ? (
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="chart-svg">
            <defs>
              <linearGradient id="grad-s1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="grad-s2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {[0, 0.33, 0.66, 1].map((ratio, i) => {
              const y = padTop + graphH - ratio * graphH;
              const val = ratio * maxHourlyVal;
              return (
                <g key={i}>
                  <line x1={padLeft} y1={y} x2={chartWidth - padRight} y2={y} className="chart-grid-line" />
                  <text
                    x={padLeft - 8}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="central"
                    className="chart-axis-text chart-y-text"
                  >
                    {val.toFixed(0)}G
                  </text>
                </g>
              );
            })}

            <line x1={padLeft} y1={padTop} x2={padLeft} y2={baselineY} className="chart-axis-line" />
            <line x1={padLeft} y1={baselineY} x2={chartWidth - padRight} y2={baselineY} className="chart-axis-line" />

            {hourly.length > 1 && (
              <>
                <path
                  d={`${s1Path} L ${padLeft + graphW} ${baselineY} L ${padLeft} ${baselineY} Z`}
                  className="chart-area-s1"
                />
                <path
                  d={`${s2Path} L ${padLeft + graphW} ${baselineY} L ${padLeft} ${baselineY} Z`}
                  className="chart-area-s2"
                />
                <path d={s1Path} className="chart-line-s1" />
                <path d={s2Path} className="chart-line-s2" />

                <circle cx={lastX} cy={s1LastY} r="4.5" fill="#0ea5e9" stroke="#ffffff" strokeWidth="2" />
                <circle cx={lastX} cy={s2LastY} r="4.5" fill="#6366f1" stroke="#ffffff" strokeWidth="2" />
              </>
            )}

            {hourly.map((pt, idx) => {
              const step = Math.max(1, Math.ceil(hourly.length / (isMobile ? 3 : 5)));
              if (idx % step === 0 || idx === hourly.length - 1) {
                const x = padLeft + (idx / (hourly.length - 1 || 1)) * graphW;
                const timeLabel = isMobile ? pt.time.slice(5, 13) + ':00' : pt.time.slice(5, 16);
                const align = idx === 0 ? 'start' : (idx === hourly.length - 1 ? 'end' : 'middle');

                return (
                  <g key={idx}>
                    <line x1={x} y1={baselineY} x2={x} y2={baselineY + 4} className="chart-tick-line" />
                    <text
                      x={x}
                      y={baselineY + 16}
                      textAnchor={align}
                      dominantBaseline="central"
                      className="chart-axis-text chart-x-text"
                    >
                      {timeLabel}
                    </text>
                  </g>
                );
              }
              return null;
            })}
          </svg>
        ) : (
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="chart-svg">
            {[0, 0.33, 0.66, 1].map((ratio, i) => {
              const y = padTop + graphH - ratio * graphH;
              const val = ratio * maxDailyVal;
              return (
                <g key={i}>
                  <line x1={padLeft} y1={y} x2={chartWidth - padRight} y2={y} className="chart-grid-line" />
                  <text
                    x={padLeft - 8}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="central"
                    className="chart-axis-text chart-y-text"
                  >
                    {val.toFixed(1)}G
                  </text>
                </g>
              );
            })}

            <line x1={padLeft} y1={padTop} x2={padLeft} y2={baselineY} className="chart-axis-line" />
            <line x1={padLeft} y1={baselineY} x2={chartWidth - padRight} y2={baselineY} className="chart-axis-line" />

            {daily.map((d, idx) => {
              const totalBars = daily.length;
              const groupW = graphW / totalBars;
              const barW = Math.max(6, (groupW - (isMobile ? 8 : 12)) / 2);
              const xCenter = padLeft + idx * groupW + groupW / 2;

              const s1H = ((d.server1_delta_gb || 0) / maxDailyVal) * graphH;
              const s2H = ((d.server2_delta_gb || 0) / maxDailyVal) * graphH;

              const s1Y = baselineY - s1H;
              const s2Y = baselineY - s2H;

              return (
                <g key={idx}>
                  <rect
                    x={xCenter - barW - 1.5}
                    y={s1Y}
                    width={barW}
                    height={Math.max(2, s1H)}
                    fill="#0ea5e9"
                    rx="2"
                  />
                  <rect
                    x={xCenter + 1.5}
                    y={s2Y}
                    width={barW}
                    height={Math.max(2, s2H)}
                    fill="#6366f1"
                    rx="2"
                  />
                  <line x1={xCenter} y1={baselineY} x2={xCenter} y2={baselineY + 4} className="chart-tick-line" />
                  <text
                    x={xCenter}
                    y={baselineY + 16}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="chart-axis-text chart-x-text"
                  >
                    {d.date.slice(5)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
};

// 服务器卡片
const ServerCard = ({ nodeTag, data }) => {
  if (!data) return null;

  const { ip, status, traffic, ecs_info } = data;
  const isRunning = status === 'Running';

  return (
    <div className="server-card">
      <div className="card-top-header">
        <div className="server-title-group">
          <div className="server-main-title">
            <span className="node-name">{nodeTag}</span>
            <span className="masked-ip-pill">{ip}</span>
          </div>
          <div className="server-sub-tag">阿里云香港 ECS · 2000M BGP</div>
        </div>

        <div className="server-status-pills">
          <span className={`status-pill ${isRunning ? 'status-pill-online' : 'status-pill-offline'}`}>
            <span className="dot"></span>
            <span>{isRunning ? '运行中' : '已关机'}</span>
          </span>
          <span className="status-pill status-pill-bgp">
            <Wifi size={11} />
            <span>BGP 专线</span>
          </span>
        </div>
      </div>

      <div className="gauge-section">
        <CircularGauge
          used={traffic.used_gb}
          total={traffic.threshold_gb}
          percentage={traffic.percentage}
        />

        <div className="gauge-details">
          <div className="metric-row">
            <span className="metric-label">当月已用流量</span>
            <span className="metric-value metric-value-highlight">
              {formatNum(traffic.used_gb, 2)} <small>GB</small>
            </span>
          </div>

          <div className="metric-row">
            <span className="metric-label">剩余安全额度</span>
            <span className="metric-value">
              {formatNum(traffic.remaining_gb, 2)} <small>/ {traffic.threshold_gb} GB</small>
            </span>
          </div>

          <div className="progress-bar-wrap">
            <div
              className="progress-bar-fill"
              style={{
                width: `${Math.min(traffic.percentage, 100)}%`,
                background:
                  traffic.percentage >= 85
                    ? 'linear-gradient(90deg, #f59e0b, #f43f5e)'
                    : 'linear-gradient(90deg, #06b6d4, #10b981)'
              }}
            ></div>
          </div>
        </div>
      </div>

      <div className="card-mini-grid">
        <div className="mini-stat-box">
          <span className="title">日均消耗速率</span>
          <span className="num">~{formatNum(traffic.daily_avg_gb, 2)} GB/天</span>
        </div>

        <div className="mini-stat-box">
          <span className="title">预计可用天数</span>
          <span className="num" style={{ color: traffic.days_left_est < 10 ? '#f43f5e' : 'inherit' }}>
            {traffic.days_left_est > 90 ? '> 90 天' : `~${traffic.days_left_est} 天`}
          </span>
        </div>

        <div className="mini-stat-box">
          <span className="title">峰值共享带宽</span>
          <span className="num">{traffic.bandwidth_mbps} Mbps</span>
        </div>
      </div>

      <div className="card-footer">
        <div className="spec-item">
          <Cpu size={12} />
          <span>{ecs_info?.cpu || 2} vCPU / {ecs_info?.memory || 0.5} GB</span>
        </div>
        <div className="spec-item">
          <ShieldCheck size={12} color="#10b981" />
          <span>阈值 180GB 自动关机防护</span>
        </div>
        <div className="spec-item" style={{ fontFamily: 'var(--font-mono)' }}>
          cn-hongkong
        </div>
      </div>
    </div>
  );
};

export default function App() {
  // 服务端首屏数据直出支持 (SSR-Lite: 零延迟即刻渲染)
  const initialData = typeof window !== 'undefined' ? window.__INITIAL_DATA__ : null;

  const [themeMode, setThemeMode] = useState(() => {
    return localStorage.getItem('traffic_guard_theme') || 'system';
  });
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);
  const themeDropdownRef = useRef(null);

  const [overview, setOverview] = useState(() => initialData?.overview || null);
  const [history, setHistory] = useState(() => initialData?.history || null);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(30);
  const [lastUpdated, setLastUpdated] = useState(() => {
    return initialData?.overview?.timestamp ? initialData.overview.timestamp.slice(11) : '';
  });

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target)) {
        setShowThemeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    localStorage.setItem('traffic_guard_theme', themeMode);

    const applyTheme = () => {
      let isDark = false;
      if (themeMode === 'dark') {
        isDark = true;
      } else if (themeMode === 'system') {
        isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      } else {
        isDark = false;
      }
      document.body.className = isDark ? 'dark-theme' : 'light-theme';
    };

    applyTheme();

    if (themeMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme();
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [themeMode]);

  const selectTheme = (mode) => {
    setThemeMode(mode);
    setShowThemeDropdown(false);
  };

  const getThemeInfo = () => {
    if (themeMode === 'light') return { label: '浅色模式', icon: <Sun size={14} /> };
    if (themeMode === 'dark') return { label: '深色模式', icon: <Moon size={14} /> };
    return { label: '跟随系统', icon: <Laptop size={14} /> };
  };

  const fetchData = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [ovRes, histRes] = await Promise.all([
        fetch(`${API_BASE}/api/overview${isManual ? '?force=1' : ''}`).then(r => r.json()),
        fetch(`${API_BASE}/api/history`).then(r => r.json())
      ]);

      setOverview(ovRes);
      setHistory(histRes);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Failed to fetch monitoring data:', err);
    } finally {
      if (isManual) {
        setTimeout(() => setRefreshing(false), 300);
      }
    }
  };

  // 如果首屏没有内嵌数据，则进行初始化拉取
  useEffect(() => {
    if (!initialData?.overview) {
      fetchData(false);
    }
  }, []);

  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const timer = setInterval(() => {
      fetchData(false);
    }, autoRefreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefreshInterval]);

  const summary = overview?.summary || {
    total_used_gb: 40.65,
    total_threshold_gb: 360,
    total_remaining_gb: 319.35,
    total_percentage: 11.3,
    nodes_online: 2,
    nodes_total: 2,
    running_count: 2
  };

  const currentTheme = getThemeInfo();

  return (
    <div className="main-viewport">
      <div className="bg-ambient">
        <div className="glow-orb-1"></div>
        <div className="glow-orb-2"></div>
      </div>

      <div className="dashboard-container">
        {/* 顶部导航栏 */}
        <header className="dashboard-header">
          <div className="header-brand">
            <div className="brand-icon-box">
              <svg width="22" height="22" viewBox="0 0 64 64" fill="none">
                <path d="M 14 33 L 24 33 L 29 19 L 36 45 L 41 29 L 50 33" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="brand-titles">
              <h1>
                流量守卫
                <span className="badge badge-online">
                  <span className="badge-dot"></span> 守卫生效中
                </span>
              </h1>
              <p>阿里云 CDT 流量安全监控 · 180GB/台 额度守护 · 超额自动停机</p>
            </div>
          </div>

          <div className="header-controls">
            <select
              className="select-input"
              value={autoRefreshInterval}
              onChange={e => setAutoRefreshInterval(Number(e.target.value))}
              title="自动刷新间隔"
            >
              <option value={10}>⚡ 10s 刷新</option>
              <option value={30}>⏱ 30s 刷新</option>
              <option value={60}>⌛ 60s 刷新</option>
              <option value={0}>⏹ 暂停刷新</option>
            </select>

            <button
              className="btn btn-primary"
              onClick={() => fetchData(true)}
              disabled={refreshing}
            >
              <RefreshCw size={13} className={refreshing ? 'spin' : ''} />
              <span>{refreshing ? '刷新中' : '刷新'}</span>
            </button>

            <div className="theme-dropdown-wrapper" ref={themeDropdownRef}>
              <button
                className="btn btn-theme-toggle"
                onClick={() => setShowThemeDropdown(prev => !prev)}
                title="选择主题模式"
              >
                {currentTheme.icon}
                <span>{currentTheme.label}</span>
                <ChevronDown size={12} style={{ opacity: 0.7 }} />
              </button>

              {showThemeDropdown && (
                <div className="theme-popover-menu">
                  <div
                    className={`theme-option ${themeMode === 'system' ? 'selected' : ''}`}
                    onClick={() => selectTheme('system')}
                  >
                    <Laptop size={15} />
                    <span>跟随系统</span>
                    {themeMode === 'system' && <Check size={14} className="check-icon" />}
                  </div>

                  <div
                    className={`theme-option ${themeMode === 'light' ? 'selected' : ''}`}
                    onClick={() => selectTheme('light')}
                  >
                    <Sun size={15} />
                    <span>浅色模式</span>
                    {themeMode === 'light' && <Check size={14} className="check-icon" />}
                  </div>

                  <div
                    className={`theme-option ${themeMode === 'dark' ? 'selected' : ''}`}
                    onClick={() => selectTheme('dark')}
                  >
                    <Moon size={15} />
                    <span>深色模式</span>
                    {themeMode === 'dark' && <Check size={14} className="check-icon" />}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* 概览摘要卡片 */}
        <section className="summary-grid">
          <div className="summary-card">
            <div className="summary-icon icon-blue">
              <HardDrive size={18} />
            </div>
            <div className="summary-meta">
              <div className="label">两机总消耗</div>
              <div className="value">{formatNum(summary.total_used_gb, 2)} <small>GB</small></div>
              <div className="subtext">总额度 {summary.total_threshold_gb} GB ({summary.total_percentage}%)</div>
            </div>
          </div>

          <div className="summary-card">
            <div className="summary-icon icon-emerald">
              <ShieldCheck size={18} />
            </div>
            <div className="summary-meta">
              <div className="label">剩余安全额度</div>
              <div className="value" style={{ color: '#10b981' }}>{formatNum(summary.total_remaining_gb, 2)} <small>GB</small></div>
              <div className="subtext">超额自动关机保安全</div>
            </div>
          </div>

          <div className="summary-card">
            <div className="summary-icon icon-cyan">
              <Wifi size={18} />
            </div>
            <div className="summary-meta">
              <div className="label">节点运行状态</div>
              <div className="value">{summary.running_count} / {summary.nodes_total} <small>正常</small></div>
              <div className="subtext">BGP 专线防护中</div>
            </div>
          </div>

          <div className="summary-card">
            <div className="summary-icon icon-amber">
              <Clock size={18} />
            </div>
            <div className="summary-meta">
              <div className="label">最近同步时间</div>
              <div className="value" style={{ fontSize: '1.02rem' }}>{lastUpdated || '实时同步'}</div>
              <div className="subtext">每分钟防护监测</div>
            </div>
          </div>
        </section>

        {/* 主服务器卡片网格 */}
        <main className="servers-grid">
          <ServerCard
            nodeTag="香港节点 01"
            data={overview?.servers?.server1}
          />
          <ServerCard
            nodeTag="香港节点 02"
            data={overview?.servers?.server2}
          />
        </main>

        {/* 响应式流量趋势分析图表 */}
        <ResponsiveTrafficCharts historyData={history} />

        {/* 底部版权信息 */}
        <footer className="dashboard-footer">
          <span>流量守卫 · 阿里云 CDT 流量安全防护系统 · 自动化停机保安全</span>
        </footer>
      </div>
    </div>
  );
}
