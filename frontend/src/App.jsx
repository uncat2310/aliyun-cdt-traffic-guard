import React, { useState, useEffect, useRef } from 'react';
import {
  RefreshCw,
  Sun,
  Moon,
  Laptop,
  Check,
  TrendingUp,
  Clock,
  Wifi,
  ChevronDown
} from 'lucide-react';

const API_BASE = window.location.origin;

const SERIES_COLORS = [
  '#0ea5e9',
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#f43f5e',
  '#8b5cf6',
  '#14b8a6',
  '#f97316'
];

const formatNum = (num, digits = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '0.00';
  return Number(num).toFixed(digits);
};

const serversGridClass = (count) => {
  if (count <= 1) return 'is-single';
  if (count === 2) return 'is-two';
  if (count === 3) return 'is-three';
  if (count === 4) return 'is-four';
  return 'is-many';
};

const trafficHealth = (daysLeft) => {
  const days = Number(daysLeft);
  if (!Number.isFinite(days)) return { key: 'ok', label: '健康' };
  if (days < 7) return { key: 'critical', label: '即将耗尽' };
  if (days < 15) return { key: 'warn', label: '流量预警' };
  if (days < 30) return { key: 'elevated', label: '流量偏高' };
  return { key: 'ok', label: '健康' };
};

const SPARK_WINDOW_HOURS = 3;

const incrementalValuesFor = (historyData, serverId) => {
  const hourly = historyData?.hourly || [];
  if (hourly.length < 2) return [];

  const hourDeltas = [];
  for (let i = 1; i < hourly.length; i += 1) {
    const delta = getHourlyVal(hourly[i], serverId) - getHourlyVal(hourly[i - 1], serverId);
    hourDeltas.push(delta > 0 ? delta : 0);
  }

  const windows = [];
  for (let i = 0; i + SPARK_WINDOW_HOURS <= hourDeltas.length; i += SPARK_WINDOW_HOURS) {
    const slice = hourDeltas.slice(i, i + SPARK_WINDOW_HOURS);
    windows.push(slice.reduce((sum, value) => sum + value, 0));
  }
  return windows;
};

const gaugeColor = (percentage) => {
  if (percentage >= 85) return '#f43f5e';
  if (percentage >= 65) return '#f59e0b';
  return '#0ea5e9';
};

const listServers = (overview) => {
  if (!overview?.servers) return [];
  if (Array.isArray(overview.server_ids) && overview.server_ids.length) {
    return overview.server_ids
      .map((id) => overview.servers[id])
      .filter(Boolean);
  }
  return Object.values(overview.servers);
};

const resolveSeries = (historyData, overview) => {
  if (Array.isArray(historyData?.servers) && historyData.servers.length) {
    return historyData.servers;
  }

  const fromOverview = listServers(overview).map((server, idx) => ({
    id: server.id,
    name: server.name,
    masked_ip: server.ip,
    color: SERIES_COLORS[idx % SERIES_COLORS.length]
  }));
  if (fromOverview.length) return fromOverview;

  return [];
};

const getHourlyVal = (point, seriesId) => {
  if (point?.values && point.values[seriesId] != null) return Number(point.values[seriesId]) || 0;
  return Number(point?.[`${seriesId}_gb`]) || 0;
};

const getDailyVal = (point, seriesId) => {
  if (point?.values && point.values[seriesId] != null) return Number(point.values[seriesId]) || 0;
  return Number(point?.[`${seriesId}_delta_gb`]) || 0;
};

const DonutGauge = ({ percentage = 0, size = 72, stroke = 7 }) => {
  const pct = Math.min(Math.max(Number(percentage) || 0, 0), 100);
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (pct / 100) * circumference;
  const color = gaugeColor(pct);

  return (
    <div className="donut-gauge" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="donut-track" strokeWidth={stroke} fill="none" r={radius} cx={cx} cy={cx} />
        <circle
          className="donut-progress"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          fill="none"
          r={radius}
          cx={cx}
          cy={cx}
        />
      </svg>
      <div className="donut-center">
        <span className="donut-pct" style={{ color }}>{formatNum(pct, 0)}%</span>
      </div>
    </div>
  );
};

const Sparkline = ({ values = [], color = '#0ea5e9', uid = 'node' }) => {
  const width = 280;
  const height = 48;
  const padX = 2;
  const padY = 4;
  const gid = `spark-${uid}`;

  if (!values.length) {
    return <div className="sparkline is-empty">暂无趋势</div>;
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values, 0.001);
  const min = rawMax > rawMin * 2.4 ? 0 : Math.max(0, rawMin * 0.82);
  const span = rawMax - min || 0.001;
  const points = values.map((value, idx) => {
    const x = padX + (idx / (values.length - 1 || 1)) * (width - padX * 2);
    const y = height - padY - ((value - min) / span) * (height - padY * 2);
    return [x, y];
  });
  const line = points.map((point, idx) => `${idx === 0 ? 'M' : 'L'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' ');
  const area = `${line} L ${points[points.length - 1][0].toFixed(1)} ${height} L ${points[0][0].toFixed(1)} ${height} Z`;

  return (
    <div className="sparkline">
      <div className="sparkline-caption">每 3 小时消耗</div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="sparkline-svg" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
};

const ResponsiveTrafficCharts = ({ historyData, overview }) => {
  const [activeTab, setActiveTab] = useState('hourly');
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [hover, setHover] = useState(null);
  const series = resolveSeries(historyData, overview);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!historyData || (!historyData.hourly?.length && !historyData.daily?.length) || series.length === 0) {
    return null;
  }

  const hourly = historyData.hourly || [];
  const daily = historyData.daily || [];

  const rawMaxH = Math.max(
    5,
    ...hourly.flatMap((point) => series.map((item) => getHourlyVal(point, item.id)))
  ) * 1.15;
  const maxHourlyVal = Math.ceil(rawMaxH);

  const rawMaxD = Math.max(
    0.5,
    ...daily.flatMap((point) => series.map((item) => getDailyVal(point, item.id)))
  ) * 1.25;
  const maxDailyVal = Math.ceil(rawMaxD * 10) / 10;

  const chartWidth = isMobile ? 540 : 860;
  const chartHeight = isMobile ? 210 : (series.length >= 4 ? 220 : 190);
  const padLeft = isMobile ? 48 : 58;
  const padRight = isMobile ? 16 : 24;
  const padTop = 16;
  const padBottom = isMobile ? 36 : 32;

  const graphW = chartWidth - padLeft - padRight;
  const graphH = chartHeight - padTop - padBottom;
  const baselineY = padTop + graphH;
  const lastIdx = hourly.length - 1;
  const lastX = padLeft + graphW;

  const getLinePath = (seriesId) => {
    if (hourly.length === 0) return '';
    return hourly.reduce((acc, pt, idx) => {
      const x = padLeft + (idx / (hourly.length - 1 || 1)) * graphW;
      const val = getHourlyVal(pt, seriesId);
      const y = padTop + graphH - (val / maxHourlyVal) * graphH;
      return `${acc} ${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }, '');
  };

  const barSlot = Math.max(1, series.length);

  const updateHover = (event) => {
    const wrap = event.currentTarget.parentElement;
    const svg = wrap?.querySelector('svg.chart-svg');
    if (!wrap) return;

    const wrapRect = wrap.getBoundingClientRect();
    let x = ((event.clientX - wrapRect.left) / wrapRect.width) * chartWidth;

    try {
      const ctm = svg?.getScreenCTM();
      if (ctm) {
        const mapped = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse()).x;
        if (Number.isFinite(mapped)) x = mapped;
      }
    } catch (err) {
      // keep the stretched-box fallback
    }

    const tooltipLeft = event.clientX - wrapRect.left;
    const flip = tooltipLeft > wrapRect.width * 0.68;

    if (x < padLeft || x > padLeft + graphW) {
      setHover(null);
      return;
    }
    if (activeTab === 'hourly' && hourly.length) {
      const idx = Math.round(((x - padLeft) / graphW) * (hourly.length - 1));
      const safeIdx = Math.min(hourly.length - 1, Math.max(0, idx));
      const px = padLeft + (safeIdx / (hourly.length - 1 || 1)) * graphW;
      setHover({ kind: 'hourly', idx: safeIdx, x: px, tooltipLeft, flip });
      return;
    }
    if (activeTab === 'daily' && daily.length) {
      const idx = Math.min(daily.length - 1, Math.max(0, Math.floor(((x - padLeft) / graphW) * daily.length)));
      const groupW = graphW / daily.length;
      setHover({
        kind: 'daily',
        idx,
        x: padLeft + idx * groupW + groupW / 2,
        tooltipLeft,
        flip
      });
    }
  };

  const hoverPoint = hover?.kind === 'hourly' ? hourly[hover.idx] : hover?.kind === 'daily' ? daily[hover.idx] : null;
  const hoverLabel = hoverPoint
    ? (hover.kind === 'hourly' ? hoverPoint.time.slice(5, 16) : hoverPoint.date)
    : '';

  return (
    <div className={`analytics-section ${series.length >= 4 ? 'is-dense' : ''}`}>
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
        {series.map((item) => (
          <div className="legend-item" key={item.id}>
            <span className="legend-dot" style={{ background: item.color }}></span>
            <span>
              {item.name}
              {item.masked_ip ? ` (${item.masked_ip})` : ''}
            </span>
          </div>
        ))}
      </div>

      <div className="chart-container" onMouseLeave={() => setHover(null)}>
        {activeTab === 'hourly' ? (
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            preserveAspectRatio="none"
            className="chart-svg"
          >
            <defs>
              {series.map((item) => (
                <linearGradient key={item.id} id={`grad-${item.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={item.color} stopOpacity="0.4" />
                  <stop offset="100%" stopColor={item.color} stopOpacity="0.0" />
                </linearGradient>
              ))}
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

            {hourly.length > 1 && series.map((item) => {
              const path = getLinePath(item.id);
              const lastY = padTop + graphH - (getHourlyVal(hourly[lastIdx], item.id) / maxHourlyVal) * graphH;
              return (
                <g key={item.id}>
                  <path
                    d={`${path} L ${padLeft + graphW} ${baselineY} L ${padLeft} ${baselineY} Z`}
                    fill={`url(#grad-${item.id})`}
                    stroke="none"
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke={item.color}
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <circle cx={lastX} cy={lastY} r="4.5" fill={item.color} stroke="#ffffff" strokeWidth="2" />
                </g>
              );
            })}

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

            {hover?.kind === 'hourly' && hoverPoint && (
              <g className="chart-hover-layer">
                <line x1={hover.x} y1={padTop} x2={hover.x} y2={baselineY} className="chart-hover-line" />
                {series.map((item) => {
                  const val = getHourlyVal(hoverPoint, item.id);
                  const y = padTop + graphH - (val / maxHourlyVal) * graphH;
                  return <circle key={item.id} cx={hover.x} cy={y} r="4" fill={item.color} stroke="#fff" strokeWidth="1.5" />;
                })}
              </g>
            )}
          </svg>
        ) : (
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            preserveAspectRatio="none"
            className="chart-svg"
          >
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
              const barW = Math.max(6, (groupW - (isMobile ? 8 : 12)) / barSlot);
              const xCenter = padLeft + idx * groupW + groupW / 2;
              const clusterWidth = barW * barSlot + (barSlot - 1) * 3;
              const clusterStart = xCenter - clusterWidth / 2;
              const active = hover?.kind === 'daily' && hover.idx === idx;

              return (
                <g key={idx} opacity={hover?.kind === 'daily' && !active ? 0.45 : 1}>
                  {series.map((item, sIdx) => {
                    const value = getDailyVal(d, item.id);
                    const height = (value / maxDailyVal) * graphH;
                    return (
                      <rect
                        key={item.id}
                        x={clusterStart + sIdx * (barW + 3)}
                        y={baselineY - height}
                        width={barW}
                        height={Math.max(2, height)}
                        fill={item.color}
                        rx="2"
                      />
                    );
                  })}
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

        <div className="chart-hit" onMouseMove={updateHover} />

        {hover && hoverPoint && (
          <div
            className={`chart-tooltip ${hover.flip ? 'is-left' : ''}`}
            style={{ left: `${hover.tooltipLeft}px` }}
          >
            <div className="chart-tooltip-time">{hoverLabel}</div>
            {series.map((item) => {
              const value = hover.kind === 'hourly'
                ? getHourlyVal(hoverPoint, item.id)
                : getDailyVal(hoverPoint, item.id);
              return (
                <div className="chart-tooltip-row" key={item.id}>
                  <span className="legend-dot" style={{ background: item.color }}></span>
                  <span className="chart-tooltip-name">{item.name}</span>
                  <span className="chart-tooltip-val">{formatNum(value, 2)} GB</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const ServerCard = ({ data, sparkline = [], variant = 'compact' }) => {
  if (!data) return null;

  const traffic = data.traffic || {};
  const isRunning = data.status === 'Running';
  const usedPct = Math.min(Number(traffic.percentage) || 0, 100);
  const threshold = traffic.threshold_gb ?? 180;
  const daysLeft = traffic.days_left_est;
  const health = trafficHealth(daysLeft);
  const daysText = daysLeft > 90 ? '> 90 天' : `${formatNum(daysLeft ?? 0, 0)} 天`;
  const isHero = variant === 'hero';

  return (
    <article className={`server-card ${isHero ? 'is-hero' : 'is-compact'} ${isRunning ? 'is-online' : 'is-offline'}`}>
      <header className="card-top-header">
        <div className="node-id">
          <div className="node-name">{data.name || data.id || '节点'}</div>
          <div className="node-ip">{data.ip || '*.*.*.*'}</div>
        </div>
        <div className="node-flags">
          <span className={`status-text ${isRunning ? 'is-on' : 'is-off'}`}>
            <span className="dot"></span>
            {isRunning ? '运行中' : '已关机'}
          </span>
          {isRunning && (
            <span className={`health-chip is-${health.key}`}>{health.label}</span>
          )}
        </div>
      </header>

      <div className="card-gauge">
        <DonutGauge percentage={usedPct} size={isHero ? 120 : 72} stroke={isHero ? 10 : 7} />
      </div>

      <div className="card-stats">
        <div className="used-block">
          <div className="used-value">
            {formatNum(traffic.used_gb, 2)}
            <small>GB</small>
          </div>
          <div className="used-caption">本月已用 / {formatNum(threshold, 0)} GB</div>
        </div>
        <div className="kpi-grid">
          <div className="kpi-item">
            <div className="kpi-num">{formatNum(traffic.remaining_gb, 2)} <small>GB</small></div>
            <div className="kpi-lab">剩余额度</div>
          </div>
          <div className="kpi-item">
            <div className="kpi-num">{formatNum(traffic.daily_avg_gb, 2)} <small>GB/d</small></div>
            <div className="kpi-lab">日均消耗</div>
          </div>
          <div className="kpi-item">
            <div className={`kpi-num ${daysLeft < 10 ? 'is-hot' : ''}`}>{daysText}</div>
            <div className="kpi-lab">预计可用</div>
          </div>
        </div>
      </div>

      <div className="card-spark">
        <Sparkline values={sparkline} color={gaugeColor(usedPct)} uid={data.id || data.name || 'node'} />
      </div>
    </article>
  );
};

export default function App() {
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

  const serverList = listServers(overview);
  const nodeTotal = overview?.summary?.nodes_total ?? serverList.length;

  const summary = overview?.summary || {
    total_used_gb: 0,
    total_threshold_gb: 0,
    total_remaining_gb: 0,
    total_percentage: 0,
    nodes_online: 0,
    nodes_total: nodeTotal,
    running_count: 0
  };

  const currentTheme = getThemeInfo();
  const fleetDaily = serverList.reduce((sum, node) => sum + (Number(node.traffic?.daily_avg_gb) || 0), 0);
  const fleetDays = fleetDaily > 0 ? Math.round(summary.total_remaining_gb / fleetDaily) : null;
  const isHeroLayout = serverList.length === 1;

  return (
    <div className={`main-viewport ${serverList.length >= 3 ? 'is-tall' : ''}`}>
      <div className="bg-ambient">
        <div className="glow-orb-1"></div>
        <div className="glow-orb-2"></div>
      </div>

      <div className={`dashboard-container ${serverList.length >= 3 ? 'is-wide' : ''}`}>
        <header className="dashboard-header">
          <div className="header-brand">
            <div className="brand-icon-box">
              <svg width="22" height="22" viewBox="0 0 64 64" fill="none">
                <path d="M 14 33 L 24 33 L 29 19 L 36 45 L 41 29 L 50 33" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="brand-titles">
              <h1 className="brand-wordmark">流量守卫</h1>
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

        <section className="summary-grid">
          <div className="summary-card">
            <DonutGauge percentage={summary.total_percentage} size={44} stroke={4.5} />
            <div className="summary-meta">
              <div className="label">总流量</div>
              <div className="value">
                {formatNum(summary.total_used_gb, 2)}
                <small>/ {formatNum(summary.total_threshold_gb, 0)} GB</small>
              </div>
            </div>
          </div>

          <div className="summary-card">
            <div className="summary-meta">
              <div className="label">剩余额度</div>
              <div className="value is-remain">{formatNum(summary.total_remaining_gb, 2)} <small>GB</small></div>
              {fleetDays != null && (
                <div className="summary-hint">按当前速度约 {fleetDays > 90 ? '> 90' : fleetDays} 天</div>
              )}
            </div>
          </div>

          <div className="summary-card">
            <div className="summary-icon icon-cyan">
              <Wifi size={18} />
            </div>
            <div className="summary-meta">
              <div className="label">节点状态</div>
              <div className="value">{summary.running_count || 0}<span className="value-sep">/</span>{summary.nodes_total || 0} <small>在线</small></div>
            </div>
          </div>

          <div className="summary-card">
            <div className="summary-icon icon-amber">
              <Clock size={18} />
            </div>
            <div className="summary-meta">
              <div className="label">数据同步</div>
              <div className="value is-time">{lastUpdated || '--:--:--'}</div>
            </div>
          </div>
        </section>

        {serverList.length > 0 ? (
          <main
            className={`servers-grid ${serversGridClass(serverList.length)}`}
            data-count={serverList.length}
          >
            {serverList.map((server) => (
              <ServerCard
                key={server.id}
                data={server}
                variant={isHeroLayout ? 'hero' : 'compact'}
                sparkline={incrementalValuesFor(history, server.id)}
              />
            ))}
          </main>
        ) : (
          <main className="servers-grid is-single">
            <div className="server-card empty-config-card">
              <div className="server-main-title">
                <span className="node-name">尚未配置监控节点</span>
              </div>
              <p className="empty-config-text">
                在 <code>config.json</code> 的 <code>servers</code> 里填写至少一台 ECS 的 AccessKey 与实例 ID。
                单机只保留一个节点即可；复制示例后未改的占位节点会被自动忽略。
              </p>
            </div>
          </main>
        )}

        <ResponsiveTrafficCharts historyData={history} overview={overview} />

        <footer className="dashboard-footer">
          <span>流量守卫 · 阿里云 CDT 流量安全防护系统 · 自动化停机保安全</span>
        </footer>
      </div>
    </div>
  );
}
