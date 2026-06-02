import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconChartLine,
  IconDownload,
  IconRefreshCw,
  IconUpload,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiKeysApi, authFilesApi, quotaApi, usageApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types/authFile';
import type { QuotaSnapshotRecord } from '@/types/quota';
import type { UsagePayload, UsageTimeRange } from '@/types/usage';
import {
  credentialProviderKey,
  getCredentialNextRetryAt,
  getCredentialStatusMessage,
  isCredentialCooling,
  isCredentialDisabled,
  isCredentialEffectivelyAvailable,
  isCredentialQuotaLimited,
  isCredentialUnauthorized,
  readCredentialText,
} from '@/utils/authFileStatus';
import { downloadBlob } from '@/utils/download';
import {
  buildQuotaAvailabilityByAuthIndex,
  resolveCredentialAuthIndex,
  type QuotaAvailability,
} from '@/utils/quotaAvailability';
import {
  USAGE_TIME_RANGE_OPTIONS,
  buildUsageAnalytics,
  formatCompactNumber,
  formatCurrency,
  formatLatency,
  formatPercent,
  getModelPriceEstimate,
  maskCredential,
  type GroupRow,
  type TimeBucket,
} from '@/utils/usageAnalytics';
import styles from './UsagePage.module.scss';

type UsageFilters = {
  range: UsageTimeRange;
  provider: string;
  model: string;
  account: string;
  endpoint: string;
  failedOnly: boolean;
};

type Series = {
  label: string;
  color: string;
  fill?: string;
  values: number[];
};

const DEFAULT_FILTERS: UsageFilters = {
  range: 'today',
  provider: 'all',
  model: 'all',
  account: 'all',
  endpoint: 'all',
  failedOnly: false,
};

const chartWidth = 760;
const chartHeight = 132;
const chartPadding = { top: 12, right: 12, bottom: 22, left: 38 };
const RECENT_PAGE_SIZES = [25, 50, 100];

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const sha256Hex = async (value: string): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return '';
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value.trim()));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const buildApiKeyLabelsByHash = async (keys: string[]): Promise<Record<string, string>> => {
  const entries = await Promise.all(
    keys
      .map((key) => key.trim())
      .filter(Boolean)
      .map(async (key) => {
        const hash = await sha256Hex(key);
        return hash ? ([hash, maskCredential(key)] as [string, string]) : null;
      })
  );
  return Object.fromEntries(entries.filter((entry): entry is [string, string] => Boolean(entry)));
};

type CredentialCoolingRow = {
  name: string;
  provider: string;
  message: string;
  nextRetryAt: number;
};

type CredentialHealthGroup = {
  provider: string;
  total: number;
  cooling: number;
  disabled: number;
  available: number;
};

type CredentialHealthSummary = {
  total: number;
  cooling: number;
  disabled: number;
  available: number;
  rows: CredentialCoolingRow[];
  groups: CredentialHealthGroup[];
  error: string;
};

const EMPTY_CREDENTIAL_SUMMARY: CredentialHealthSummary = {
  total: 0,
  cooling: 0,
  disabled: 0,
  available: 0,
  rows: [],
  groups: [],
  error: '',
};

const buildCredentialHealthSummary = (
  files: AuthFileItem[],
  nowMs = Date.now(),
  quotaSnapshots: QuotaSnapshotRecord[] = []
): CredentialHealthSummary => {
  const groups = new Map<string, CredentialHealthGroup>();
  const quotaAvailabilityByAuthIndex = buildQuotaAvailabilityByAuthIndex(quotaSnapshots);
  const ensureGroup = (provider: string): CredentialHealthGroup => {
    const existing = groups.get(provider);
    if (existing) return existing;
    const next = { provider, total: 0, cooling: 0, disabled: 0, available: 0 };
    groups.set(provider, next);
    return next;
  };

  const quotaAvailabilityForFile = (file: AuthFileItem): QuotaAvailability => {
    const authIndex = resolveCredentialAuthIndex(file);
    return authIndex ? quotaAvailabilityByAuthIndex.get(authIndex) ?? null : null;
  };

  const isQuotaAwareCooling = (file: AuthFileItem): boolean => {
    if (isCredentialDisabled(file) || isCredentialUnauthorized(file)) return false;

    const snapshotAvailability = quotaAvailabilityForFile(file);
    if (snapshotAvailability === true && isCredentialQuotaLimited(file, nowMs)) return false;
    if (snapshotAvailability === false) return true;

    return isCredentialCooling(file, nowMs);
  };

  const isQuotaAwareAvailable = (file: AuthFileItem): boolean => {
    if (isCredentialDisabled(file) || isCredentialUnauthorized(file)) return false;

    const snapshotAvailability = quotaAvailabilityForFile(file);
    if (snapshotAvailability === false) return false;
    if (snapshotAvailability === true) {
      if (isCredentialQuotaLimited(file, nowMs) || isCredentialEffectivelyAvailable(file, nowMs)) {
        return true;
      }
      return false;
    }

    return isCredentialEffectivelyAvailable(file, nowMs);
  };

  const rows = files
    .filter((file) => isQuotaAwareCooling(file) && getCredentialNextRetryAt(file) > nowMs)
    .map((file) => {
      const nextRetryAt = getCredentialNextRetryAt(file);
      const message = getCredentialStatusMessage(file);
      return {
        name: readCredentialText(file.name) || readCredentialText(file.id) || '未命名凭证',
        provider: credentialProviderKey(file),
        message,
        nextRetryAt,
      };
    })
    .sort((a, b) => a.nextRetryAt - b.nextRetryAt);

  let cooling = 0;
  let disabled = 0;
  let available = 0;

  files.forEach((file) => {
    const group = ensureGroup(credentialProviderKey(file));
    const fileCooling = isQuotaAwareCooling(file);
    const fileDisabled = isCredentialDisabled(file);
    const fileAvailable = isQuotaAwareAvailable(file);

    group.total += 1;
    if (fileDisabled) {
      group.disabled += 1;
      disabled += 1;
    }
    if (fileCooling) {
      group.cooling += 1;
      cooling += 1;
    }
    if (fileAvailable) {
      group.available += 1;
      available += 1;
    }
  });

  const total = files.length;

  return {
    total,
    cooling,
    disabled,
    available,
    rows,
    groups: Array.from(groups.values()).sort((left, right) => {
      if (right.cooling !== left.cooling) return right.cooling - left.cooling;
      if (right.available !== left.available) return right.available - left.available;
      return left.provider.localeCompare(right.provider);
    }),
    error: '',
  };
};

const maxOfSeries = (series: Series[]) => {
  const max = Math.max(0, ...series.flatMap((item) => item.values));
  return max > 0 ? max : 1;
};

const pointFor = (value: number, index: number, count: number, maxValue: number) => {
  const innerWidth = chartWidth - chartPadding.left - chartPadding.right;
  const innerHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const x = chartPadding.left + (count <= 1 ? 0 : (index / (count - 1)) * innerWidth);
  const y = chartPadding.top + innerHeight - (value / maxValue) * innerHeight;
  return `${x.toFixed(2)},${y.toFixed(2)}`;
};

const areaPath = (values: number[], maxValue: number) => {
  if (!values.length) return '';
  const points = values.map((value, index) => pointFor(value, index, values.length, maxValue));
  const innerHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const baseline = chartPadding.top + innerHeight;
  return `M ${points[0]} L ${points.slice(1).join(' L ')} L ${
    chartWidth - chartPadding.right
  },${baseline} L ${chartPadding.left},${baseline} Z`;
};

function ChartFrame({
  title,
  legend,
  children,
}: {
  title: string;
  legend?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.chartPanel}>
      <div className={styles.panelHeader}>
        <h2>{title}</h2>
        {legend && <div className={styles.chartLegend}>{legend}</div>}
      </div>
      {children}
    </section>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <>
      {items.map((item) => (
        <span key={item.label} className={styles.legendItem}>
          <span style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </>
  );
}

function SeriesChart({ buckets, series }: { buckets: TimeBucket[]; series: Series[] }) {
  const maxValue = maxOfSeries(series);
  const yTicks = [maxValue, maxValue / 2, 0];
  const shownLabels = buckets.filter((_, index) => {
    const step = Math.max(1, Math.ceil(buckets.length / 6));
    return index % step === 0 || index === buckets.length - 1;
  });

  return (
    <div className={styles.chartSurface}>
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="趋势图">
        <g className={styles.gridLines}>
          {yTicks.map((tick) => {
            const y = pointFor(tick, 0, 2, maxValue).split(',')[1];
            return (
              <g key={tick}>
                <line x1={chartPadding.left} x2={chartWidth - chartPadding.right} y1={y} y2={y} />
                <text x={chartPadding.left - 8} y={Number(y) + 4} textAnchor="end">
                  {formatCompactNumber(tick)}
                </text>
              </g>
            );
          })}
        </g>
        {series.map((item) =>
          item.fill ? (
            <path
              key={`${item.label}-fill`}
              d={areaPath(item.values, maxValue)}
              fill={item.fill}
              opacity="0.78"
            />
          ) : null
        )}
        {series.map((item) => (
          <polyline
            key={item.label}
            points={item.values
              .map((value, index) => pointFor(value, index, item.values.length, maxValue))
              .join(' ')}
            fill="none"
            stroke={item.color}
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        <g className={styles.xAxis}>
          {shownLabels.map((bucket) => {
            const index = buckets.indexOf(bucket);
            const x = pointFor(0, index, buckets.length, maxValue).split(',')[0];
            return (
              <text key={`${bucket.label}-${bucket.startMs}`} x={x} y={chartHeight - 6} textAnchor="middle">
                {bucket.label}
              </text>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = styles[`tone${tone}`] ?? '';

  return (
    <article className={`${styles.metricCard} ${toneClass}`}>
      <div className={styles.metricTopline}>
        <span>{label}</span>
        <span className={styles.metricSpark} />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function CredentialChip({
  label,
  fullLabel,
  authIndex,
  apiKey,
}: {
  label: string;
  fullLabel?: string;
  authIndex?: string;
  apiKey?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const fullValue = fullLabel?.trim();
  const hasDetails = Boolean(fullValue || authIndex || apiKey);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const handlePopoverOpen = (event: Event) => {
      const nextID = (event as CustomEvent<string>).detail;
      if (nextID !== id) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('usage-credential-popover-open', handlePopoverOpen);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('usage-credential-popover-open', handlePopoverOpen);
    };
  }, [id, open]);

  const toggleOpen = () => {
    if (!hasDetails) return;
    setOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        window.dispatchEvent(new CustomEvent('usage-credential-popover-open', { detail: id }));
      }
      return nextOpen;
    });
  };

  return (
    <span ref={rootRef} className={styles.credentialCell}>
      <button
        type="button"
        className={styles.credentialButton}
        onClick={toggleOpen}
        disabled={!hasDetails}
        aria-expanded={open}
      >
        {label}
      </button>
      {open && hasDetails && (
        <span className={styles.credentialPopover} role="dialog">
          {fullValue && (
            <span>
              <em>凭证完整值</em>
              <strong>{fullValue}</strong>
            </span>
          )}
          {authIndex && (
            <span>
              <em>凭证索引</em>
              <strong>{authIndex}</strong>
            </span>
          )}
          {apiKey && (
            <span>
              <em>调用 API Key</em>
              <strong>{apiKey}</strong>
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function HealthLedger({ rows }: { rows: GroupRow[] }) {
  const grouped = rows.slice(0, 8).reduce<Record<string, GroupRow[]>>((acc, row) => {
    const key = row.provider || 'Other';
    acc[key] = [...(acc[key] ?? []), row];
    return acc;
  }, {});

  return (
    <section className={styles.sidePanel}>
      <div className={styles.panelHeader}>
        <h2>健康账本</h2>
        <span className={styles.panelHint}>提供商 / 凭证</span>
      </div>
      <div className={styles.ledgerTable}>
        <div className={styles.ledgerHead}>
          <span>凭证</span>
          <span>请求数</span>
          <span>成功率</span>
          <span>P95</span>
        </div>
        {Object.entries(grouped).map(([provider, providerRows]) => (
          <div key={provider} className={styles.ledgerGroup}>
            <div className={styles.ledgerProvider}>
              <span className={styles.statusDot} />
              {provider}
            </div>
            {providerRows.map((row) => (
              <div key={row.key} className={styles.ledgerRow}>
                <CredentialChip
                  label={row.label}
                  fullLabel={row.fullLabel}
                  apiKey={row.apiKey}
                />
                <span>{formatCompactNumber(row.requests)}</span>
                <span className={row.successRate >= 95 ? styles.good : styles.bad}>
                  {formatPercent(row.successRate)}
                </span>
                <span>{formatLatency(row.p95LatencyMs)}</span>
              </div>
            ))}
          </div>
        ))}
        {rows.length === 0 && <div className={styles.emptyInline}>暂无凭证统计</div>}
      </div>
    </section>
  );
}

function APIKeyUsagePanel({ rows }: { rows: GroupRow[] }) {
  return (
    <section className={styles.sidePanel}>
      <div className={styles.panelHeader}>
        <h2>API Key 调用</h2>
        <span className={styles.panelHint}>总数 / 成功 / 失败</span>
      </div>
      <div className={styles.distributionRows}>
        <div className={styles.distributionHead}>
          <span>API Key</span>
          <span>总数</span>
          <span>成功</span>
          <span>失败</span>
        </div>
        {rows.map((row) => (
          <div key={row.key} className={styles.distributionRow}>
            <span title={row.fullLabel || row.label}>{row.label}</span>
            <strong>{row.requests.toLocaleString()}</strong>
            <em className={styles.good}>{row.success.toLocaleString()}</em>
            <em className={row.failure > 0 ? styles.bad : ''}>{row.failure.toLocaleString()}</em>
          </div>
        ))}
        {rows.length === 0 && <div className={styles.emptyInline}>暂无 API Key 调用记录</div>}
      </div>
    </section>
  );
}

function RequestDistributionPanel({ rows }: { rows: GroupRow[] }) {
  return (
    <section className={styles.sidePanel}>
      <div className={styles.panelHeader}>
        <h2>请求分布</h2>
        <span className={styles.panelHint}>总数 / 成功 / 失败</span>
      </div>
      <div className={styles.distributionRows}>
        <div className={styles.distributionHead}>
          <span>端点</span>
          <span>总数</span>
          <span>成功</span>
          <span>失败</span>
        </div>
        {rows.map((row) => (
          <div key={row.key} className={styles.distributionRow}>
            <span title={row.label}>{row.label}</span>
            <strong>{row.requests.toLocaleString()}</strong>
            <em className={styles.good}>{row.success.toLocaleString()}</em>
            <em className={row.failure > 0 ? styles.bad : ''}>{row.failure.toLocaleString()}</em>
          </div>
        ))}
        {rows.length === 0 && <div className={styles.emptyInline}>暂无请求分布</div>}
      </div>
    </section>
  );
}

const providerDisplayName = (provider: string): string => {
  switch (provider) {
    case 'gemini-cli':
      return 'Gemini CLI';
    case 'iflow':
      return 'iFlow';
    case 'unknown':
      return '其他';
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
};

function CredentialCoolingPanel({ summary }: { summary: CredentialHealthSummary }) {
  const coolingRate = summary.total > 0 ? (summary.cooling / summary.total) * 100 : 0;
  const visibleGroups = summary.groups.slice(0, 6);

  return (
    <section className={styles.sidePanel}>
      <div className={styles.panelHeader}>
        <h2>凭证冷却</h2>
        <span className={styles.panelHint}>按类型汇总</span>
      </div>
      <div className={styles.coolingPanelBody}>
        <div className={styles.coolingNumbers}>
          <strong>{summary.cooling}</strong>
          <span>/ {summary.total.toLocaleString()}</span>
        </div>
        <div className={styles.coolingMeta}>
          <span>可轮转 {summary.available.toLocaleString()}</span>
          <span>停用 {summary.disabled.toLocaleString()}</span>
        </div>
        <div className={styles.coolingTrack}>
          <span style={{ width: `${Math.min(100, Math.max(summary.cooling > 0 ? 8 : 0, coolingRate))}%` }} />
        </div>
        {summary.error ? (
          <div className={styles.emptyInline}>{summary.error}</div>
        ) : visibleGroups.length > 0 ? (
          <div className={styles.coolingTypeTable}>
            <div className={styles.coolingTypeHead}>
              <span>类型</span>
              <span>可用</span>
              <span>限流</span>
              <span>总量</span>
            </div>
            {visibleGroups.map((group) => (
              <div key={group.provider} className={styles.coolingTypeRow}>
                <span title={providerDisplayName(group.provider)}>{providerDisplayName(group.provider)}</span>
                <strong className={styles.good}>{group.available.toLocaleString()}</strong>
                <em className={group.cooling > 0 ? styles.bad : ''}>{group.cooling.toLocaleString()}</em>
                <small>{group.total.toLocaleString()}</small>
              </div>
            ))}
            {summary.rows.length > 0 && (
              <div className={styles.coolingNextHint}>
                最近恢复：{providerDisplayName(summary.rows[0].provider)} ·{' '}
                {new Date(summary.rows[0].nextRetryAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.emptyInline}>暂无凭证数据</div>
        )}
      </div>
    </section>
  );
}

function CostEstimatePanel({ rows, totalCost }: { rows: GroupRow[]; totalCost: number }) {
  const topRows = rows.slice(0, 5);

  return (
    <section className={styles.sidePanel}>
      <div className={styles.panelHeader}>
        <h2>预估模型成本</h2>
        <span className={styles.panelHint}>非真实账单</span>
      </div>
      <div className={styles.costEstimateBody}>
        <div className={styles.costEstimateTotal}>
          <strong>{formatCurrency(totalCost)}</strong>
          <span>输入/输出 Token × 内置 $/1M 单价</span>
        </div>
        <div className={styles.costRows}>
          {topRows.map((row) => {
            const price = getModelPriceEstimate(row.label);
            const sourceLabel = price.source === 'fallback' ? '默认价' : '匹配价';
            return (
              <div key={row.key} className={styles.costRow}>
                <span title={row.label}>{row.label}</span>
                <strong>{formatCurrency(row.cost)}</strong>
                <em>
                  {sourceLabel} ${price.input}/{price.output}
                </em>
              </div>
            );
          })}
          {topRows.length === 0 && <div className={styles.emptyInline}>暂无模型成本估算</div>}
        </div>
      </div>
    </section>
  );
}

function TokenBreakdownPanel({
  total,
  items,
}: {
  total: number;
  items: Array<{ label: string; value: number; color: string }>;
}) {
  const denominator = Math.max(1, sum(items.map((item) => item.value)));

  return (
    <section className={styles.sidePanel}>
      <div className={styles.panelHeader}>
        <h2>Token 构成</h2>
        <span className={styles.panelHint}>{formatCompactNumber(total)} 总量</span>
      </div>
      <div className={styles.breakdownRows}>
        {items.map((item) => (
          <div key={item.label} className={styles.breakdownRow}>
            <div>
              <span style={{ background: item.color }} />
              <em>{item.label}</em>
              <strong>{formatCompactNumber(item.value)}</strong>
            </div>
            <div className={styles.breakdownTrack}>
              <span style={{ width: `${Math.max(4, (item.value / denominator) * 100)}%`, background: item.color }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentRequestsTable({
  rows,
}: {
  rows: ReturnType<typeof buildUsageAnalytics>['recentRows'];
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(RECENT_PAGE_SIZES[0]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(rows.length, startIndex + pageSize);
  const visibleRows = rows.slice(startIndex, endIndex);

  const handlePageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize);
    setPage(1);
  };

  return (
    <section className={styles.recentPanel}>
      <div className={styles.panelHeader}>
        <h2>最近请求</h2>
        <span className={styles.panelHint}>共 {rows.length.toLocaleString()} 条</span>
      </div>
      <div className={styles.tableToolbar}>
        <span>
          显示 {rows.length === 0 ? 0 : startIndex + 1}-{endIndex} 条
        </span>
        <div className={styles.pageSizeSwitch} aria-label="每页条数">
          {RECENT_PAGE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={pageSize === size ? styles.activePageSize : ''}
              onClick={() => handlePageSizeChange(size)}
            >
              {size}/页
            </button>
          ))}
        </div>
      </div>
      <div className={styles.tableScroller}>
        <table className={styles.usageTable}>
          <thead>
            <tr>
              <th>时间</th>
              <th>状态</th>
              <th>提供商</th>
              <th>模型</th>
              <th>端点</th>
              <th>凭证账号</th>
              <th>输入</th>
              <th>输出</th>
              <th>总量</th>
              <th>延迟</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                <td>{row.time}</td>
                <td>
                  <span className={`${styles.statusPill} ${row.failed ? styles.statusFail : styles.statusOk}`}>
                    {row.status}
                  </span>
                </td>
                <td>{row.provider}</td>
                <td>{row.model}</td>
                <td>{row.endpoint}</td>
                <td>
                  <CredentialChip
                    label={row.account}
                    fullLabel={row.accountFull}
                    authIndex={row.authIndex}
                    apiKey={row.apiKey}
                  />
                </td>
                <td>{formatCompactNumber(row.inputTokens)}</td>
                <td>{formatCompactNumber(row.outputTokens)}</td>
                <td>{formatCompactNumber(row.totalTokens)}</td>
                <td>{formatLatency(row.latencyMs)}</td>
                <td>{row.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className={styles.emptyInline}>暂无请求明细</div>}
      </div>
      {rows.length > 0 && (
        <div className={styles.paginationBar}>
          <span>
            第 {currentPage} / {pageCount} 页
          </span>
          <div>
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(1)}>
              首页
            </button>
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              上一页
            </button>
            <button
              type="button"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              下一页
            </button>
            <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(pageCount)}>
              末页
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function UsagePage() {
  const showNotification = useNotificationStore((state) => state.showNotification);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [payload, setPayload] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statisticsEnabled, setStatisticsEnabled] = useState<boolean | null>(null);
  const [filters, setFilters] = useState<UsageFilters>(DEFAULT_FILTERS);
  const [apiKeyLabelsByHash, setApiKeyLabelsByHash] = useState<Record<string, string>>({});
  const [credentialSummary, setCredentialSummary] = useState<CredentialHealthSummary>(
    EMPTY_CREDENTIAL_SUMMARY
  );
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usageData, enabled, authFilesResult, quotaSnapshots, apiKeyLabels] = await Promise.all([
        usageApi.getUsage(),
        usageApi.getStatisticsEnabled().catch(() => null),
        authFilesApi
          .list()
          .then((data) => ({ data, error: '' }))
          .catch((err) => ({
            data: null,
            error: err instanceof Error ? err.message : '凭证列表读取失败',
          })),
        quotaApi.getSnapshots().catch(() => ({ snapshots: [], token_usage: {} })),
        apiKeysApi
          .list()
          .then((keys) => buildApiKeyLabelsByHash(keys))
          .catch(() => ({} as Record<string, string>)),
      ]);
      setPayload(usageData);
      setStatisticsEnabled(enabled);
      setApiKeyLabelsByHash(apiKeyLabels);
      setCredentialSummary(
        authFilesResult.data
          ? buildCredentialHealthSummary(
              authFilesResult.data.files ?? [],
              Date.now(),
              quotaSnapshots.snapshots
            )
          : { ...EMPTY_CREDENTIAL_SUMMARY, error: authFilesResult.error || '凭证列表读取失败' }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载使用统计失败';
      setError(message);
      showNotification(`加载使用统计失败：${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useHeaderRefresh(loadUsage);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const analytics = useMemo(
    () => buildUsageAnalytics(payload, filters, apiKeyLabelsByHash),
    [apiKeyLabelsByHash, filters, payload]
  );

  const setFilter = <K extends keyof UsageFilters>(key: K, value: UsageFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await usageApi.exportUsage();
      const blob =
        response.data instanceof Blob
          ? response.data
          : new Blob([response.data], { type: 'application/x-ndjson' });
      downloadBlob({ filename: 'usage-events.jsonl', blob });
      showNotification('使用统计已导出', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : '导出失败';
      showNotification(`导出失败：${message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const response = await usageApi.importUsage(text);
      const result = response.data;
      showNotification(
        `导入完成：新增 ${result.added ?? 0}，跳过 ${result.skipped ?? 0}`,
        'success'
      );
      await loadUsage();
    } catch (err) {
      const message = err instanceof Error ? err.message : '导入失败';
      showNotification(`导入失败：${message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleStatisticsToggle = async (enabled: boolean) => {
    setStatisticsEnabled(enabled);
    try {
      await usageApi.updateStatisticsEnabled(enabled);
      showNotification(enabled ? '使用统计已开启' : '使用统计已关闭', 'success');
    } catch (err) {
      setStatisticsEnabled((current) => !current);
      const message = err instanceof Error ? err.message : '更新失败';
      showNotification(`更新统计开关失败：${message}`, 'error');
    }
  };

  const summary = analytics.summary;
  const requestSeries: Series[] = [
    {
      label: '成功',
      color: '#3f8f63',
      fill: 'rgba(80, 151, 102, 0.28)',
      values: analytics.buckets.map((bucket) => bucket.success),
    },
    {
      label: '失败',
      color: '#c65746',
      fill: 'rgba(198, 87, 70, 0.12)',
      values: analytics.buckets.map((bucket) => bucket.failure),
    },
  ];
  const tokenSeries: Series[] = [
    {
      label: '输入 Token',
      color: '#c5a45d',
      fill: 'rgba(205, 170, 93, 0.26)',
      values: analytics.buckets.map((bucket) => bucket.inputTokens),
    },
    {
      label: '输出 Token',
      color: '#756d5f',
      fill: 'rgba(117, 109, 95, 0.18)',
      values: analytics.buckets.map((bucket) => bucket.outputTokens),
    },
  ];
  const latencySeries: Series[] = [
    {
      label: 'P50',
      color: '#4f9568',
      values: analytics.buckets.map((bucket) => bucket.p50LatencyMs ?? 0),
    },
    {
      label: 'P95',
      color: '#c6a14a',
      values: analytics.buckets.map((bucket) => bucket.p95LatencyMs ?? 0),
    },
    {
      label: 'P99',
      color: '#c65746',
      values: analytics.buckets.map((bucket) => bucket.p99LatencyMs ?? 0),
    },
  ];
  const topCostRows = analytics.modelRows.slice(0, 5);
  const tokenBreakdown = [
    { label: '输入 Token', value: summary.inputTokens, color: '#7ca982' },
    { label: '输出 Token', value: summary.outputTokens, color: '#bfa36d' },
    { label: '缓存 Token', value: summary.cachedTokens, color: '#8a8174' },
    { label: '思考 Token', value: summary.reasoningTokens, color: '#c65746' },
  ];

  return (
    <div className={styles.usagePage}>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.titleLine}>
            <IconChartLine size={22} />
            <h1>使用统计</h1>
            <span className={styles.liveBadge}>Live</span>
          </div>
          <p>监控 API 用量、性能与可靠性，定位高成本模型、异常端点和凭证健康状态。</p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" size="sm" onClick={loadUsage} loading={loading}>
            <IconRefreshCw size={15} />
            刷新
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExport} loading={exporting}>
            <IconDownload size={15} />
            导出
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => importInputRef.current?.click()}
            loading={importing}
          >
            <IconUpload size={15} />
            导入
          </Button>
          {statisticsEnabled !== null && (
            <div className={styles.statisticsToggle}>
              <span>统计</span>
              <ToggleSwitch
                checked={statisticsEnabled}
                onChange={handleStatisticsToggle}
                ariaLabel="切换使用统计"
              />
            </div>
          )}
        </div>
      </div>

      <input
        ref={importInputRef}
        type="file"
        accept=".json,.jsonl,application/json,application/x-ndjson,text/plain"
        hidden
        onChange={handleImportChange}
      />

      <section className={styles.filterRail}>
        <div className={styles.rangeTabs}>
          {USAGE_TIME_RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filters.range === option.value ? styles.activeRange : ''}
              onClick={() => setFilter('range', option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Select
          value={filters.provider}
          onChange={(value) => setFilter('provider', value)}
          options={[
            { value: 'all', label: '全部提供商' },
            ...analytics.providerOptions.map((value) => ({ value, label: value })),
          ]}
        />
        <Select
          value={filters.model}
          onChange={(value) => setFilter('model', value)}
          options={[
            { value: 'all', label: '全部模型' },
            ...analytics.modelOptions.map((value) => ({ value, label: value })),
          ]}
        />
        <Select
          value={filters.account}
          onChange={(value) => setFilter('account', value)}
          options={[
            { value: 'all', label: '全部凭证' },
            ...analytics.accountOptions,
          ]}
        />
        <Select
          value={filters.endpoint}
          onChange={(value) => setFilter('endpoint', value)}
          options={[
            { value: 'all', label: '全部端点' },
            ...analytics.endpointOptions.map((value) => ({ value, label: value })),
          ]}
        />
        <ToggleSwitch
          checked={filters.failedOnly}
          onChange={(checked) => setFilter('failedOnly', checked)}
          label="仅失败"
          labelPosition="left"
        />
      </section>

      {statisticsEnabled === false && (
        <div className={styles.warningBanner}>
          使用统计当前处于关闭状态。页面仍会展示历史持久化数据，但不会继续记录新的请求。
        </div>
      )}

      {error && <div className={styles.errorBanner}>{error}</div>}

      <section className={styles.metricGrid} aria-label="统计概览">
        <MetricCard
          label="总请求数"
          value={summary.totalRequests.toLocaleString()}
          detail={`${summary.successCount.toLocaleString()} 成功 / ${summary.failureCount.toLocaleString()} 失败`}
          tone="neutral"
        />
        <MetricCard
          label="成功率"
          value={formatPercent(summary.successRate)}
          detail={`失败率 ${formatPercent(summary.failureRate)}`}
          tone={summary.successRate >= 95 ? 'success' : 'danger'}
        />
        <MetricCard
          label="总 Token"
          value={formatCompactNumber(summary.totalTokens)}
          detail={`${formatCompactNumber(summary.inputTokens)} 输入 / ${formatCompactNumber(summary.outputTokens)} 输出`}
          tone="neutral"
        />
        <MetricCard
          label="平均延迟"
          value={formatLatency(summary.averageLatencyMs)}
          detail={`P95 ${formatLatency(summary.p95LatencyMs)}`}
          tone={summary.p95LatencyMs && summary.p95LatencyMs > 3000 ? 'warning' : 'neutral'}
        />
        <MetricCard
          label="预估成本"
          value={formatCurrency(summary.estimatedCost)}
          detail="估算值，非真实账单"
          tone="warning"
        />
        <MetricCard
          label="凭证冷却"
          value={`${credentialSummary.cooling}/${credentialSummary.total}`}
          detail={
            credentialSummary.error
              ? credentialSummary.error
              : `${credentialSummary.available.toLocaleString()} 可轮转 / ${credentialSummary.disabled.toLocaleString()} 停用`
          }
          tone={credentialSummary.cooling > 0 ? 'warning' : 'success'}
        />
      </section>

      {loading ? (
        <div className={styles.loadingState}>
          <LoadingSpinner size={28} />
          正在加载使用统计...
        </div>
      ) : (
        <>
          <div className={styles.mainGrid}>
            <div className={styles.primaryColumn}>
              <ChartFrame
                title="请求趋势"
                legend={<Legend items={requestSeries.map((item) => ({ label: item.label, color: item.color }))} />}
              >
                <SeriesChart buckets={analytics.buckets} series={requestSeries} />
              </ChartFrame>
              <div className={styles.chartPair}>
                <ChartFrame
                  title="Token 趋势"
                  legend={<Legend items={tokenSeries.map((item) => ({ label: item.label, color: item.color }))} />}
                >
                  <SeriesChart buckets={analytics.buckets} series={tokenSeries} />
                </ChartFrame>
                <ChartFrame
                  title="延迟分位"
                  legend={<Legend items={latencySeries.map((item) => ({ label: item.label, color: item.color }))} />}
                >
                  <SeriesChart buckets={analytics.buckets} series={latencySeries} />
                </ChartFrame>
              </div>
              <div className={styles.insightStack}>
                <CostEstimatePanel rows={topCostRows} totalCost={summary.estimatedCost} />
                <TokenBreakdownPanel total={summary.totalTokens} items={tokenBreakdown} />
              </div>
            </div>
            <aside className={styles.sideColumn}>
              <CredentialCoolingPanel summary={credentialSummary} />
              <HealthLedger rows={analytics.accountRows} />
              <div className={styles.insightStack}>
                <RequestDistributionPanel rows={analytics.endpointRows} />
                <APIKeyUsagePanel rows={analytics.apiKeyRows} />
              </div>
            </aside>
          </div>
          <RecentRequestsTable rows={analytics.recentRows} />
        </>
      )}
    </div>
  );
}
