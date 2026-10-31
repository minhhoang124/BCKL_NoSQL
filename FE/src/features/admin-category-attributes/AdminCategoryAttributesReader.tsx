import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { ApiError, getAuthSessionVersion } from '../../services/apiClient';
import type { AttributeDefinition, AttributeOption, AttributeReadApi, ReadPage } from './attributeReadApi';
import styles from './AdminCategoryAttributesReader.module.css';

interface Props { categoryId: number; api?: AttributeReadApi; pageSize?: number }
const noRows: ReadPage<AttributeDefinition> = { items: [], nextCursor: null };
function message(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return 'Phiên đăng nhập không còn hợp lệ. Hãy đăng nhập lại.';
  if (error instanceof ApiError && error.status === 403) return 'Không có quyền đọc cấu hình Admin.';
  if (error instanceof ApiError && error.status === 404) return 'Ngành hàng hoặc thuộc tính không còn tồn tại.';
  return 'Không tải được cấu hình. Hãy thử tải lại; chưa có dữ liệu để kết luận.';
}
export function AdminCategoryAttributesReader(props: Props) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Đang kiểm tra phiên đăng nhập…</p>;
  if (!user || !user.isActive || user.role !== 'ADMIN') return <p role="alert">Cần tài khoản Admin đang hoạt động.</p>;
  if (!props.api) return <p role="status">Tạm thời không tải được thuộc tính ngành hàng. Vui lòng thử lại sau.</p>;
  if (!Number.isInteger(props.categoryId) || props.categoryId <= 0 || props.categoryId > 2147483647 ||
    !Number.isInteger(props.pageSize ?? 50) || (props.pageSize ?? 50) < 1 || (props.pageSize ?? 50) > 100) return <p role="alert">Cấu hình đọc không hợp lệ.</p>;
  return <Reader key={`${user.id}:${getAuthSessionVersion()}:${props.categoryId}`} {...props} api={props.api} />;
}
function Reader({ categoryId, api, pageSize = 50 }: Props & { api: AttributeReadApi }) {
  const [filter, setFilter] = useState('ALL');
  const [list, setList] = useState(noRows);
  const [detail, setDetail] = useState<AttributeDefinition | null>(null);
  const [options, setOptions] = useState<ReadPage<AttributeOption>>({ items: [], nextCursor: null });
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const listFlight = useRef<AbortController | null>(null);
  const detailFlight = useRef<AbortController | null>(null);
  const session = useRef(getAuthSessionVersion());
  const current = (controller: AbortController) => !controller.signal.aborted && getAuthSessionVersion() === session.current;
  function clearDetail() {
    detailFlight.current?.abort(); detailFlight.current = null;
    setDetail(null); setOptions({ items: [], nextCursor: null }); setDetailError(''); setReading(false);
  }
  function fail(error: unknown) {
    if (error instanceof ApiError && [401, 403].includes(error.status ?? 0)) {
      listFlight.current?.abort(); detailFlight.current?.abort();
      setBlocked(true); setList(noRows); clearDetail(); setBusy(false);
    }
    return message(error);
  }
  async function loadList(afterId?: number) {
    if (blocked || listFlight.current) return;
    const controller = new AbortController(); listFlight.current = controller;
    setBusy(true); setError(''); clearDetail();
    if (afterId === undefined) setList(noRows);
    try {
      const result = await api.list(categoryId, { limit: pageSize, afterId, ...(filter === 'ALL' ? {} : { isActive: filter === 'ACTIVE' }) }, controller.signal);
      if (current(controller)) setList(previous => ({ ...result, items: afterId === undefined ? result.items : [...previous.items, ...result.items] }));
    } catch (e) { if (current(controller)) { setList(noRows); setError(fail(e)); } }
    finally { if (listFlight.current === controller) { listFlight.current = null; setBusy(false); } }
  }
  useEffect(() => {
    session.current = getAuthSessionVersion();
    void loadList();
    return () => { listFlight.current?.abort(); listFlight.current = null; detailFlight.current?.abort(); detailFlight.current = null; };
    // Changing the server filter/API invalidates all loaded pages and pending reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, api, categoryId, pageSize]);
  async function select(row: AttributeDefinition) {
    if (blocked) return;
    clearDetail();
    const controller = new AbortController(); detailFlight.current = controller;
    setReading(true);
    try {
      const selected = await api.detail(categoryId, row.id, controller.signal);
      if (!current(controller)) return;
      if (selected.revision !== row.revision) throw new Error('revision');
      const first = selected.dataType === 'SINGLE_SELECT' ? await api.options(categoryId, selected.id, { limit: pageSize }, controller.signal) : { items: [], nextCursor: null, definitionRevision: selected.revision };
      if (!current(controller)) return;
      if (first.definitionRevision !== selected.revision) throw new Error('revision');
      setDetail(selected); setOptions(first);
    } catch (e) {
      if (current(controller)) setDetailError(e instanceof Error && e.message === 'revision' ? 'Cấu hình đã đổi phiên bản. Tải lại danh sách trước khi đọc tiếp.' : fail(e));
    } finally { if (detailFlight.current === controller) { detailFlight.current = null; setReading(false); } }
  }
  async function moreOptions() {
    if (blocked || !detail || options.nextCursor === null || detailFlight.current) return;
    const controller = new AbortController(); detailFlight.current = controller; setReading(true);
    try {
      const result = await api.options(categoryId, detail.id, { limit: pageSize, afterId: options.nextCursor }, controller.signal);
      if (!current(controller)) return;
      if (result.definitionRevision !== detail.revision) {
        setDetail(null); setOptions({ items: [], nextCursor: null });
        setDetailError('Cấu hình đã đổi phiên bản. Tải lại danh sách trước khi đọc tiếp.');
      } else setOptions(previous => ({ ...result, items: [...previous.items, ...result.items] }));
    } catch (e) { if (current(controller)) { setDetail(null); setOptions({ items: [], nextCursor: null }); setDetailError(fail(e)); } }
    finally { if (detailFlight.current === controller) { detailFlight.current = null; setReading(false); } }
  }
  return <section className={styles.root} aria-label="Đọc cấu hình thuộc tính">
    <h1>Thuộc tính ngành hàng #{categoryId} — chỉ đọc</h1>
    <p>Không tạo/sửa cấu hình. Usage là số liệu tại thời điểm đọc, không phải quyền sửa.</p>
    <label>Trạng thái đọc <select disabled={blocked} value={filter} onChange={e => setFilter(e.target.value)}>
      <option value="ALL">Bật và tắt</option><option value="ACTIVE">Đang bật</option><option value="INACTIVE">Đã tắt</option>
    </select></label>{' '}<button disabled={busy || blocked} onClick={() => void loadList()}>Tải lại danh sách</button>
    {busy && <p role="status">Đang tải danh sách…</p>}{error && <p role="alert">{error}</p>}
    {!busy && !error && !blocked && !list.items.length && <p>Không có thuộc tính phù hợp.</p>}
    {!busy && !error && !blocked && <p>Đã tải {list.items.length} thuộc tính{list.nextCursor !== null ? ' — còn trang tiếp theo' : ' — đã tải hết danh sách'}.</p>}
    <div className={styles.columns}><section aria-label="Danh sách thuộc tính chỉ đọc">
      {list.items.map(row => <button className={styles.row} key={row.id} disabled={blocked || busy} onClick={() => void select(row)}>
        {row.name} · {row.isActive ? 'Bật' : 'Tắt'} · v{row.revision}
      </button>)}
      {list.nextCursor !== null && <button disabled={busy || blocked} onClick={() => void loadList(list.nextCursor!)}>Tải thêm thuộc tính</button>}
    </section><section aria-label="Chi tiết thuộc tính chỉ đọc" aria-live="polite">
      {reading && <p role="status">Đang tải chi tiết/options…</p>}{detailError && <p role="alert">{detailError}</p>}
      {detail && <><h2>{detail.name}</h2><p>ID {detail.id} · {detail.slug} · {detail.dataType} · v{detail.revision}</p>
        <p>{detail.isActive ? 'Đang bật' : 'Đã tắt'} · Thứ tự: {detail.sortOrder} · {detail.usage.referencedProductCount} sản phẩm tham chiếu</p>
        <p>Bắt buộc: {String(detail.isRequired)} · Bộ lọc: {String(detail.isFilterable)} · Tùy chỉnh: {String(detail.allowsCustom)}</p>
        <p>Cập nhật: {detail.updatedAt}</p>
        {detail.dataType === 'SINGLE_SELECT' && <><h3>Lựa chọn (gồm cả đã tắt)</h3>
          <p>Đã tải {options.items.length} lựa chọn{options.nextCursor !== null ? ' — chưa tải hết' : ' — hết trang tại lần đọc này'}.</p>
          {options.items.map(row => <p key={row.id}>{row.value} · {row.slug} · {row.isActive ? 'Bật' : 'Tắt'} · {row.referencedProductCount} sản phẩm</p>)}
          {options.nextCursor !== null && <button disabled={reading || blocked} onClick={() => void moreOptions()}>Tải thêm lựa chọn</button>}</>}
      </>}
    </section></div>
  </section>;
}
