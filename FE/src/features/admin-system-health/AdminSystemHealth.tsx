import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { ApiError, getAuthSessionVersion } from '../../services/apiClient';
import type {
  AdminSystemHealth as HealthResponse,
  CapabilityName,
  ComponentName,
  HealthStatus,
  SystemHealthApi,
} from './systemHealthApi';
import styles from './AdminSystemHealth.module.css';
import { healthResponseTravelMs } from './systemHealthApi';
import { aggregateCapabilities, capabilityNames, effectiveCapabilities } from './searchHealthContract.generated';

interface Props { api?: SystemHealthApi; embedded?: boolean; pollMs?: number }
const labels: Record<HealthStatus, string> = {
  READY: 'Sẵn sàng', DEGRADED: 'Suy giảm', UNAVAILABLE: 'Không khả dụng', UNKNOWN: 'Chưa xác định',
};
const capabilityLabels: Record<CapabilityName, string> = {
  semanticText: 'Tìm kiếm văn bản ngữ nghĩa', imageSearch: 'Tìm kiếm bằng ảnh', hybridText: 'Tìm kiếm kết hợp',
};
const componentLabels: Record<ComponentName, string> = {
  clipImage: 'CLIP ảnh', clipText: 'CLIP văn bản', faiss: 'FAISS', elasticsearch: 'Elasticsearch',
};
const reasonLabels: Record<string, string> = {
  NOT_CHECKED: 'Chưa kiểm tra', SNAPSHOT_STALE: 'Kết quả đã hết hạn', PROBE_BUSY: 'Bộ kiểm tra đang bận',
  PROBE_TIMEOUT: 'Kiểm tra quá thời gian', CLOCK_SKEW: 'Đồng hồ hệ thống lệch', MODEL_NOT_LOADED: 'Model chưa được tải',
  ENCODE_FAILED: 'Không tạo được embedding', INVALID_EMBEDDING: 'Embedding không hợp lệ',
  DIMENSION_MISMATCH: 'Số chiều model và index không khớp', INDEX_NOT_LOADED: 'Index chưa được tải',
  INDEX_SEARCH_FAILED: 'Không đọc được index', INVALID_INDEX_RESULT: 'Kết quả index không hợp lệ',
  ES_UNREACHABLE: 'Không kết nối được Elasticsearch', ES_TIMEOUT: 'Elasticsearch quá thời gian',
  ES_AUTH_FAILED: 'Elasticsearch từ chối quyền', ES_INDEX_MISSING: 'Thiếu index Elasticsearch',
  ES_MAPPING_INVALID: 'Mapping Elasticsearch không hợp lệ', ES_QUERY_FAILED: 'Truy vấn Elasticsearch thất bại',
  RRF_CONFIG_INVALID: 'Cấu hình RRF không hợp lệ', AI_TIMEOUT: 'AI service quá thời gian',
  AI_UNREACHABLE: 'Không kết nối được AI service', AI_INVALID_RESPONSE: 'Phản hồi AI không đúng contract',
  EMPTY_INDEX: 'Index đang trống', ES_REPLICA_WARNING: 'Elasticsearch có cảnh báo replica',
};

export function AdminSystemHealth({ api, embedded = false, pollMs = 30000 }: Props) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Đang kiểm tra phiên đăng nhập…</p>;
  if (!user || user.role !== 'ADMIN' || !user.isActive) return <p role="alert">Cần tài khoản Admin đang hoạt động.</p>;
  if (!Number.isInteger(pollMs) || pollMs < 1000) return <p role="alert">Chu kỳ cập nhật sức khỏe không hợp lệ.</p>;
  return <HealthScreen key={`${user.id}:${getAuthSessionVersion()}`} api={api} embedded={embedded} pollMs={pollMs} />;
}

function message(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return 'Phiên đăng nhập không còn hợp lệ. Hãy đăng nhập lại.';
  if (error instanceof ApiError && error.status === 403) return 'Tài khoản hiện tại không có quyền xem sức khỏe hệ thống.';
  if (error instanceof ApiError && error.status === 502) return error.message;
  return 'Không tải được sức khỏe hệ thống. Hãy kiểm tra Backend rồi thử lại.';
}

function HealthScreen({ api, embedded, pollMs }: Required<Pick<Props, 'embedded' | 'pollMs'>> & Pick<Props, 'api'>) {
  const [observation, setObservation] = useState<{
    data: HealthResponse; monotonic: number; wall: number;
  } | null>(null);
  const [busy, setBusy] = useState(Boolean(api));
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const blockedLatch = useRef(false);
  const flight = useRef<AbortController | null>(null);
  const session = useRef(getAuthSessionVersion());

  async function load() {
    if (!api || flight.current || blockedLatch.current || session.current !== getAuthSessionVersion()) return;
    const controller = new AbortController();
    flight.current = controller; setBusy(true); setError('');
    try {
      const response = await api.read(controller.signal);
      if (!controller.signal.aborted && session.current === getAuthSessionVersion())
        setObservation({ data: response, monotonic: performance.now(), wall: Date.now() });
    } catch (failure) {
      if (!controller.signal.aborted && session.current === getAuthSessionVersion()) {
        setObservation(null); setError(message(failure));
        if (failure instanceof ApiError && [401, 403].includes(failure.status ?? 0)) {
          blockedLatch.current = true;
          setBlocked(true);
        }
      }
    } finally {
      if (flight.current === controller) { flight.current = null; setBusy(false); }
    }
  }

  useEffect(() => {
    void load();
    if (!api) return;
    const timer = window.setInterval(() => void load(), pollMs);
    return () => { window.clearInterval(timer); flight.current?.abort(); flight.current = null; };
    // api/poll changes remount at the integration boundary; load uses the active session key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, pollMs]);

  return <section className={`${styles.layout} ${embedded ? styles.embedded : ''}`} aria-label="Sức khỏe hệ thống">
    <header className={styles.header}><div><p className={styles.eyebrow}>BCKL / ADMIN · SYSTEM HEALTH</p>
      <h1>Sức khỏe hệ thống</h1><p>Trạng thái đọc từ Backend; trình duyệt không gọi trực tiếp AI, Elasticsearch hoặc FAISS.</p></div>
      <button className={styles.refresh} disabled={!api || busy || blocked} onClick={() => void load()}>{busy ? 'Đang cập nhật…' : 'Cập nhật ngay'}</button>
    </header>
    <aside className={styles.notice}>Đây là readiness kỹ thuật tại thời điểm kiểm tra, không chứng minh outbox đã đồng bộ hết hoặc chất lượng Precision/Recall đạt.</aside>
    {!api && <div className={styles.empty}><h2>Chưa nối Backend Search Health</h2><p>Không hiển thị dữ liệu mẫu dưới nhãn live.</p></div>}
    {busy && !observation && <p role="status" className={styles.statusLine}>Đang tải sức khỏe hệ thống…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {observation && <HealthDetails key={`${observation.data.servedAt}:${observation.monotonic}:${observation.wall}`}
      observation={observation} pollMs={pollMs} />}
  </section>;
}

function Badge({ status }: { status: HealthStatus }) {
  return <span className={`${styles.badge} ${styles[status.toLowerCase()]}`}>{labels[status]}</span>;
}
const formatTime = (value: string | null) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : 'Chưa có';
const formatCodes = (codes: readonly string[]) => codes.length ? codes.map(code => reasonLabels[code] ?? `Mã chưa nhận diện: ${code}`).join(' · ') : 'Không có cảnh báo';

function HealthDetails({ observation, pollMs }: {
  observation: { data: HealthResponse; monotonic: number; wall: number }; pollMs: number;
}) {
  const { data } = observation;
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, performance.now() - observation.monotonic, Date.now() - observation.wall));
  const elapsedHighWatermark = useRef(elapsed);
  const travel = healthResponseTravelMs(data);
  const now = Date.parse(data.servedAt) + travel + elapsed;
  const snapshot = data.search.snapshot;
  const capabilities = snapshot ? effectiveCapabilities(snapshot, now) : null;
  const aggregate = capabilities
    ? aggregateCapabilities(capabilityNames.map((name) => capabilities[name].status))
    : 'UNKNOWN';

  useEffect(() => {
    if (!snapshot) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const deadlines = [Date.parse(snapshot.generatedAt) + 60000,
      ...Object.values(snapshot.components).flatMap((row) => row.expiresAt ? [Date.parse(row.expiresAt)] : [])];
    // Browser wall-clock skew cancels at the receipt anchor. Positive wall-clock
    // elapsed also covers sleep when performance.now may pause; it cannot extend TTL.
    const age = () => Math.max(elapsedHighWatermark.current,
      performance.now() - observation.monotonic, Date.now() - observation.wall);
    const schedule = () => {
      if (disposed) return;
      if (timer !== undefined) clearTimeout(timer);
      const current = Date.parse(data.servedAt) + travel + age();
      const upcoming = deadlines.filter((deadline) => deadline > current);
      if (upcoming.length) timer = setTimeout(update, Math.max(1, Math.ceil(Math.min(...upcoming) - current)));
    };
    const update = () => {
      if (disposed) return;
      elapsedHighWatermark.current = age();
      setElapsed(elapsedHighWatermark.current);
      schedule();
    };
    schedule();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [data, observation, snapshot, travel]);
  return <div className={styles.content}>
    <div className={styles.summaryGrid}>
      <article className={styles.summary}><div><span>PostgreSQL</span><strong>Nguồn dữ liệu nghiệp vụ</strong></div><Badge status={data.postgresql.status} /><small>Kiểm lúc {formatTime(data.postgresql.checkedAt)}</small></article>
      <article className={styles.summary}><div><span>Search</span><strong>Khả dụng tổng hợp</strong></div><Badge status={aggregate} /><small>{data.search.errorCode ? reasonLabels[data.search.errorCode] : `Thu lúc ${formatTime(data.collectedAt)}`}</small></article>
    </div>
    <section className={styles.panel}><div className={styles.panelHead}><div><h2>Khả năng tìm kiếm</h2><p>Trạng thái còn hiệu lực; không kéo dài hạn của snapshot Backend.</p></div></div>
      {!capabilities ? <p className={styles.emptyText}>Chưa có snapshot AI hợp lệ; không suy đoán trạng thái từng nhánh.</p> :
        <div className={styles.cardGrid}>{(Object.keys(capabilityLabels) as CapabilityName[]).map(name => <article className={styles.card} key={name}>
          <div className={styles.cardTitle}><h3>{capabilityLabels[name]}</h3><Badge status={capabilities[name].status} /></div>
          <p>{formatCodes(capabilities[name].reasonCodes)}</p></article>)}</div>}
    </section>
    <section className={styles.panel}><div className={styles.panelHead}><div><h2>Thành phần Search</h2><p>Chi tiết probe gần nhất; “index trống” không có nghĩa là lỗi.</p></div>{snapshot && <small>Snapshot {formatTime(snapshot.generatedAt)}</small>}</div>
      {!snapshot ? <p className={styles.emptyText}>Không có chi tiết thành phần vì Backend chưa nhận được snapshot hợp lệ.</p> :
        <div className={styles.cardGrid}>{(Object.keys(componentLabels) as ComponentName[]).map(name => {
          const row = snapshot.components[name];
          const expired = row.expiresAt !== null && Date.parse(row.expiresAt) <= now;
          return <article className={styles.card} key={name}><div className={styles.cardTitle}><h3>{componentLabels[name]}</h3><Badge status={expired ? 'UNKNOWN' : row.status} /></div>
            {expired && <p>Quan sát gốc: {labels[row.status]} · {reasonLabels.SNAPSHOT_STALE}</p>}
            <dl><div><dt>Kiểm gần nhất</dt><dd>{formatTime(row.checkedAt)}</dd></div><div><dt>Thành công gần nhất</dt><dd>{formatTime(row.lastSuccessAt)}</dd></div>
              {'dimension' in row && <div><dt>Số chiều</dt><dd>{row.dimension ?? 'Chưa có'}</dd></div>}
              {'vectorCount' in row && <div><dt>Số vector</dt><dd>{row.vectorCount ?? 'Chưa có'}</dd></div>}
              {'readable' in row && <div><dt>Index đọc được</dt><dd>{row.readable === null ? 'Chưa rõ' : row.readable ? 'Có' : 'Không'}</dd></div>}
            </dl><p>{formatCodes([...(expired ? ['SNAPSHOT_STALE'] : row.errorCode ? [row.errorCode] : []), ...row.warningCodes])}</p></article>;
        })}</div>}
    </section>
    <footer className={styles.footer}>Backend phục vụ lúc {formatTime(data.servedAt)} · Tự cập nhật mỗi {pollMs / 1000} giây; trạng thái hết hạn được cập nhật riêng. Kết quả không đại diện cho Dashboard doanh thu hoặc toàn bộ hệ thống.</footer>
  </div>;
}
