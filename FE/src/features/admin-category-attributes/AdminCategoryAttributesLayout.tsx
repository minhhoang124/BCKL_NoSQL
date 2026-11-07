import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import styles from './AdminCategoryAttributesLayout.module.css';
import { previewChanges, previewFieldErrors, previewReason } from './attributePreviewValidation';
import type { AttributeConfirmation } from './attributePreviewValidation';

// Presentation examples only: these are NOT Backend DTOs or PostgreSQL identifiers.
export type AttributeKind = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT';
export type LayoutState = 'ready' | 'loading' | 'error' | 'pending' | 'stale' | 'unknown';
export interface AttributeOptionExample {
  sampleKey: string; value: string; slug: string; sortOrder: number;
  isActive: boolean; usage: number | null;
}
export interface CategoryAttributeExample {
  sampleKey: string; name: string; slug: string; dataType: AttributeKind;
  isRequired: boolean; isFilterable: boolean; allowsCustom: boolean;
  sortOrder: number; isActive: boolean; revision: number; usage: number | null;
  options: readonly AttributeOptionExample[];
}
interface Draft {
  name: string; slug: string; dataType: AttributeKind; isRequired: boolean;
  isFilterable: boolean; allowsCustom: boolean; sortOrder: string; isActive: boolean;
}
interface OptionDraft { value: string; slug: string; sortOrder: string; isActive: boolean }
interface OptionEditorState { selectedKey: string; drafts: Record<string, OptionDraft> }
const kinds: AttributeKind[] = ['TEXT', 'NUMBER', 'BOOLEAN', 'SINGLE_SELECT'];
const kindName: Record<AttributeKind, string> = { TEXT: 'Văn bản', NUMBER: 'Số', BOOLEAN: 'Đúng / sai', SINGLE_SELECT: 'Một lựa chọn' };
const fold = (value: string) => value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const usageText = (value: number | null) => value === null ? 'Chưa có số liệu sử dụng' : `${value} sản phẩm (minh họa)`;
const freshDraft = (item?: CategoryAttributeExample): Draft => item
  ? { ...item, sortOrder: String(item.sortOrder) }
  : { name: '', slug: '', dataType: 'TEXT', isRequired: false, isFilterable: false, allowsCustom: true, sortOrder: '0', isActive: false };
const freshOption = (item?: AttributeOptionExample): OptionDraft => item
  ? { ...item, sortOrder: String(item.sortOrder) }
  : { value: '', slug: '', sortOrder: '0', isActive: false };
const basicFieldsValid = (name: string, slug: string, order: string) => !Object.values(previewFieldErrors(name, slug, order)).some(Boolean);
const flag = (value: boolean) => value ? 'Có' : 'Không';
const attributeSummary = (draft: Draft) => ({ 'Tên': draft.name.trim(), 'Slug': draft.slug,
  'Kiểu': kindName[draft.dataType], 'Bật': flag(draft.isActive), 'Bắt buộc': flag(draft.isRequired),
  'Có thể lọc': flag(draft.isFilterable), 'Cho nhập ngoài': flag(draft.allowsCustom), 'Thứ tự': String(Number(draft.sortOrder)) });
const optionSummary = (draft: OptionDraft) => ({ 'Giá trị': draft.value.trim(), 'Slug': draft.slug,
  'Bật': flag(draft.isActive), 'Thứ tự': String(Number(draft.sortOrder)) });
type PreviewHandler = (details: AttributeConfirmation, opener: HTMLButtonElement) => void;

function ConfirmationPreview({ details, onClose, opener }: { details: AttributeConfirmation; onClose: () => void; opener: HTMLButtonElement }) {
  const titleId = useId();
  const noteId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState('');
  const reasonId = useId();
  const reasonStatus = previewReason(reason, details.policy);
  useEffect(() => {
    cancelRef.current?.focus();
    return () => { if (opener.isConnected) opener.focus(); };
  }, [opener]);
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)');
    if (!controls?.length) return;
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className={styles.backdrop}>
    <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={noteId} onKeyDown={handleKey}>
      <p className={styles.eyebrow}>XEM TRƯỚC · KHÔNG GHI DỮ LIỆU</p>
      <h2 id={titleId}>Xác nhận thay đổi cấu hình</h2><p><strong>{details.label}</strong></p>
      <p>{details.revision === undefined ? 'Tạo mới · không có revision trước đó.' : `Phiên bản mẫu đang đối chiếu: ${details.revision}. Option và definition dùng chung revision cha.`}</p>
      <ul className={styles.changes} aria-label="Các thay đổi dự kiến">{details.changes.map((change) => <li key={change.field}><strong>{change.field}</strong>: {change.before} → {change.after}</li>)}</ul>
      <p>Siết quy tắc có thể làm sản phẩm không còn công khai. Nới quy tắc có thể làm sản phẩm APPROVED / ACTIVE đủ điều kiện xuất hiện lại, chỉ khi mọi điều kiện hiện hành đều hợp lệ.</p>
      <p>Không tự duyệt lại DRAFT, HIDDEN, FROZEN hoặc REJECTED; không sửa tồn kho, đơn hàng hoặc dữ liệu lịch sử.</p>
      <label className={styles.field}>Lý do dự kiến (minh họa)
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} aria-required={details.policy} aria-invalid={!!reasonStatus.error} aria-describedby={reasonId} placeholder="Không nhập thông tin nhạy cảm; nội dung chỉ giữ trong bộ nhớ" />
      </label>
      <p id={reasonId} className={styles.hint} role="status">{reasonStatus.error || (details.policy ? 'Thay đổi chính sách: bắt buộc lý do và xác nhận riêng.' : 'Thay đổi này không bắt buộc lý do; nếu nhập vẫn phải hợp lệ.')} {reasonStatus.count}/500 ký tự sau NFC/trim.</p>
      <p className={styles.hint}>Contract #65 đã chốt lý do 10–500 ký tự Unicode, không tự cắt. Đây chỉ là kiểm tra local; chưa gửi hoặc lưu audit. Lý do không thay thế xác nhận.</p>
      <p id={noteId} className={styles.notice}>Chưa kết nối API. Nút xác nhận luôn khóa, kể cả khi đã nhập lý do. Công việc đồng bộ được tiếp nhận không đồng nghĩa index đã cập nhật xong.</p>
      <div className={styles.actions}><button ref={cancelRef} type="button" onClick={onClose}>Hủy</button><button type="button" disabled aria-describedby={noteId}>Xác nhận (chưa kết nối)</button></div>
    </div>
  </div>;
}

function AttributeEditor({ example, draft, onChange, disabled, onPreview }: {
  example?: CategoryAttributeExample; draft: Draft; onChange: (draft: Draft) => void;
  disabled: boolean; onPreview: PreviewHandler;
}) {
  const identityLocked = !!example && (example.usage === null || example.usage > 0);
  const typeLocked = identityLocked || (!!example && example.options.length > 0);
  const valid = basicFieldsValid(draft.name, draft.slug, draft.sortOrder);
  const errors = previewFieldErrors(draft.name, draft.slug, draft.sortOrder);
  const errorId = useId();
  const changes = previewChanges(example ? attributeSummary(freshDraft(example)) : {}, attributeSummary(draft));
  const policy = example ? draft.isRequired !== example.isRequired || draft.isActive !== example.isActive || draft.allowsCustom !== example.allowsCustom : draft.isActive && draft.isRequired;
  const optionsMissing = draft.dataType === 'SINGLE_SELECT' && draft.isActive && draft.isRequired && !draft.allowsCustom
    && !(example?.options.some((option) => option.isActive));
  return <form aria-label="Bản nháp thuộc tính" onSubmit={(event) => event.preventDefault()}>
    <fieldset disabled={disabled} className={styles.fields}>
      <legend>{example ? 'Sửa thuộc tính minh họa' : 'Tạo thuộc tính minh họa'}</legend>
      <label className={styles.field}>Tên thuộc tính<input value={draft.name} maxLength={120} aria-invalid={!!errors.name} aria-describedby={errors.name ? `${errorId}-name` : undefined} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
      {errors.name && <p className={styles.hint} id={`${errorId}-name`}>{errors.name}</p>}
      <label className={styles.field}>Slug thuộc tính<input value={draft.slug} disabled={identityLocked} maxLength={140} aria-invalid={!!errors.slug} aria-describedby={errors.slug ? `${errorId}-slug` : undefined} onChange={(event) => onChange({ ...draft, slug: event.target.value })} /></label>
      {errors.slug && <p className={styles.hint} id={`${errorId}-slug`}>{errors.slug}</p>}
      <label className={styles.field}>Kiểu dữ liệu<select value={draft.dataType} disabled={typeLocked} onChange={(event) => onChange({ ...draft, dataType: event.target.value as AttributeKind })}>
        {kinds.map((kind) => <option key={kind} value={kind}>{kindName[kind]}</option>)}
      </select></label>
      <label className={styles.field}>Thứ tự thuộc tính<input inputMode="numeric" value={draft.sortOrder} aria-invalid={!!errors.order} aria-describedby={errors.order ? `${errorId}-order` : undefined} onChange={(event) => onChange({ ...draft, sortOrder: event.target.value })} /></label>
      {errors.order && <p className={styles.hint} id={`${errorId}-order`}>{errors.order}</p>}
      <div className={styles.checks}>
        <label><input type="checkbox" checked={draft.isActive} onChange={(event) => onChange({ ...draft, isActive: event.target.checked })} /> Đang bật</label>
        <label><input type="checkbox" checked={draft.isRequired} onChange={(event) => onChange({ ...draft, isRequired: event.target.checked })} /> Bắt buộc</label>
        <label><input type="checkbox" checked={draft.isFilterable} onChange={(event) => onChange({ ...draft, isFilterable: event.target.checked })} /> Có thể lọc</label>
        <label><input type="checkbox" checked={draft.allowsCustom} disabled={draft.dataType !== 'SINGLE_SELECT'} onChange={(event) => onChange({ ...draft, allowsCustom: event.target.checked })} /> Cho nhập ngoài lựa chọn</label>
      </div>
      <p className={styles.hint}>Slug/kiểu đã được sản phẩm sử dụng không được đổi. Khi chưa có số liệu sử dụng, khung xem trước cũng khóa hai trường này. Có lựa chọn thì chưa đổi kiểu. Backend phải kiểm lại trong giao dịch.</p>
      <p className={styles.hint}>Giá trị false và 0 vẫn hợp lệ, không phải dữ liệu thiếu. Cờ “Có thể lọc” không tự bổ sung bộ lọc Search mới.</p>
      {!valid && <p className={styles.hint}>Để xem xác nhận: tên 2–120 ký tự, slug chữ thường/số gạch nối 2–140 ký tự, thứ tự nguyên 0–2147483647. Đây là kiểm tra sơ bộ theo đề xuất, không thay validation Backend.</p>}
      {optionsMissing && <p role="alert" className={styles.notice}>Thuộc tính bắt buộc đang bật và không cho nhập ngoài cần ít nhất một lựa chọn đang bật. Hãy cấu hình khi tắt → thêm lựa chọn → bật sau khi Backend sẵn sàng.</p>}
      {example && changes.length === 0 && <p className={styles.hint}>Chưa có thay đổi để xác nhận.</p>}
      <div className={styles.actions}><button type="button" disabled={!valid || optionsMissing || changes.length === 0} onClick={(event) => onPreview({ label: draft.name.trim(), revision: example?.revision, policy, changes }, event.currentTarget)}>Xem trước xác nhận thuộc tính</button><button type="button" disabled>Lưu thuộc tính (chưa kết nối)</button></div>
    </fieldset>
  </form>;
}

function OptionsEditor({ example, disabled, onPreview, editorState, onStateChange }: {
  example: CategoryAttributeExample; disabled: boolean;
  onPreview: PreviewHandler;
  editorState?: OptionEditorState; onStateChange: (state: OptionEditorState) => void;
}) {
  const { selectedKey, drafts } = editorState ?? { selectedKey: example.options[0]?.sampleKey ?? 'new', drafts: {} };
  const setSelectedKey = (next: string) => onStateChange({ selectedKey: next, drafts });
  const option = example.options.find((item) => item.sampleKey === selectedKey);
  const draft = drafts[selectedKey] ?? freshOption(option);
  const identityLocked = !!option && (option.usage === null || option.usage > 0);
  const errorId = useId();
  const errors = previewFieldErrors(draft.value, draft.slug, draft.sortOrder);
  const changes = previewChanges(option ? optionSummary(freshOption(option)) : {}, optionSummary(draft));
  const removesLastOption = !!option && option.isActive && !draft.isActive && example.isActive && example.isRequired && !example.allowsCustom
    && !example.options.some((item) => item.sampleKey !== option.sampleKey && item.isActive);
  const change = (next: OptionDraft) => onStateChange({ selectedKey, drafts: { ...drafts, [selectedKey]: next } });
  return <section className={styles.options} aria-label="Lựa chọn chuẩn của thuộc tính">
    <h3>Lựa chọn chuẩn · minh họa</h3>
    <p className={styles.hint}>Gồm cả lựa chọn đã tắt. Không phải phân loại tạo SKU. Không có xóa cứng; tắt vẫn giữ giá trị lịch sử.</p>
    <div className={styles.optionList}>{example.options.map((item) => <button key={item.sampleKey} type="button" disabled={disabled} aria-pressed={selectedKey === item.sampleKey} onClick={() => setSelectedKey(item.sampleKey)}>
      <strong>{item.value}</strong> · {item.isActive ? 'Bật' : 'Tắt'}<small>{usageText(item.usage)}</small>
    </button>)}<button type="button" disabled={disabled} aria-pressed={selectedKey === 'new'} onClick={() => setSelectedKey('new')}>+ Thêm lựa chọn minh họa</button></div>
    {example.options.length === 0 && <p>Chưa có lựa chọn trong ví dụ này, không phải kết quả GET thật.</p>}
    <form aria-label="Bản nháp lựa chọn" onSubmit={(event) => event.preventDefault()}>
      <fieldset disabled={disabled} className={styles.fields}>
        <legend>{option ? `Sửa lựa chọn ${option.value}` : 'Tạo lựa chọn minh họa'}</legend>
        <label className={styles.field}>Giá trị lựa chọn<input value={draft.value} disabled={identityLocked} maxLength={120} aria-invalid={!!errors.name} aria-describedby={errors.name ? `${errorId}-name` : undefined} onChange={(event) => change({ ...draft, value: event.target.value })} /></label>
        {errors.name && <p className={styles.hint} id={`${errorId}-name`}>{errors.name}</p>}
        <label className={styles.field}>Slug lựa chọn<input value={draft.slug} disabled={identityLocked} maxLength={140} aria-invalid={!!errors.slug} aria-describedby={errors.slug ? `${errorId}-slug` : undefined} onChange={(event) => change({ ...draft, slug: event.target.value })} /></label>
        {errors.slug && <p className={styles.hint} id={`${errorId}-slug`}>{errors.slug}</p>}
        <label className={styles.field}>Thứ tự lựa chọn<input inputMode="numeric" value={draft.sortOrder} aria-invalid={!!errors.order} aria-describedby={errors.order ? `${errorId}-order` : undefined} onChange={(event) => change({ ...draft, sortOrder: event.target.value })} /></label>
        {errors.order && <p className={styles.hint} id={`${errorId}-order`}>{errors.order}</p>}
        <label className={styles.checks}><input type="checkbox" checked={draft.isActive} onChange={(event) => change({ ...draft, isActive: event.target.checked })} /> Lựa chọn đang bật</label>
        <p className={styles.hint}>Đã dùng hoặc chưa biết usage: khóa đổi giá trị/slug. Tạo lựa chọn mới thay vì đổi nghĩa trên sản phẩm cũ.</p>
        {removesLastOption && <p role="alert" className={styles.notice}>Đây là lựa chọn đang bật cuối cùng của thuộc tính bắt buộc không cho nhập ngoài. Tắt có thể làm sản phẩm mất điều kiện công khai; cần xác nhận và lý do, không xóa giá trị cũ.</p>}
        {option && changes.length === 0 && <p className={styles.hint}>Chưa có thay đổi lựa chọn để xác nhận.</p>}
        <div className={styles.actions}><button type="button" disabled={!basicFieldsValid(draft.value, draft.slug, draft.sortOrder) || changes.length === 0} onClick={(event) => onPreview({ label: `${example.name} / ${draft.value.trim()}`, revision: example.revision, policy: !!option && option.isActive !== draft.isActive, changes }, event.currentTarget)}>Xem trước xác nhận lựa chọn</button><button type="button" disabled>Lưu lựa chọn (chưa kết nối)</button></div>
      </fieldset>
    </form>
  </section>;
}

/** Preparation only; never pass live data here. No fetch, Auth, API adapter or storage. */
export function AdminCategoryAttributesLayout({ examples, state = 'ready' }: { examples?: readonly CategoryAttributeExample[]; state?: LayoutState }) {
  const headingId = useId();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [kind, setKind] = useState('ALL');
  const [selectedKey, setSelectedKey] = useState(examples?.[0]?.sampleKey ?? 'new');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [optionStates, setOptionStates] = useState<Record<string, OptionEditorState>>({});
  const [confirmation, setConfirmation] = useState<{ details: AttributeConfirmation; opener: HTMLButtonElement } | null>(null);
  const interactive = examples !== undefined && state === 'ready';
  const showExamples = examples !== undefined && !['loading', 'error'].includes(state);
  const modal = interactive ? confirmation : null;
  const example = examples?.find((item) => item.sampleKey === selectedKey);
  const draftKey = example ? selectedKey : 'new';
  const draft = drafts[draftKey] ?? freshDraft(example);
  const visible = (examples ?? []).filter((item) => fold(`${item.name} ${item.slug}`).includes(fold(query))
    && (status === 'ALL' || item.isActive === (status === 'ACTIVE')) && (kind === 'ALL' || item.dataType === kind));
  const preview: PreviewHandler = (details, opener) => setConfirmation({ details, opener });
  const messages: Record<LayoutState, string> = {
    ready: 'Dữ liệu minh họa — không phải cấu hình thật.', loading: 'Minh họa trạng thái đang tải: chưa có kết quả Backend.',
    error: 'Minh họa lỗi tải: không hiển thị dữ liệu cũ như kết quả mới.',
    pending: 'Minh họa đang gửi: khóa chọn thuộc tính, bộ lọc và form; chưa có yêu cầu HTTP thật.',
    stale: 'Minh họa xung đột phiên bản: giữ bản nháp, khóa ghi; cần đọc mới và đối chiếu thủ công, không tự retry.',
    unknown: 'Minh họa chưa rõ kết quả ghi: khóa thao tác; GET lại không chứng minh yêu cầu trước đã rollback. Chưa có phục hồi bền vững.',
  };
  return <section className={styles.layout} aria-labelledby={headingId}>
    <div className={styles.content} inert={modal !== null}>
      <header className={styles.header}><div><p className={styles.eyebrow}>BCKL / ADMIN · CHUẨN BỊ GIAO DIỆN</p><h1 id={headingId}>Thuộc tính ngành hàng</h1><p>Định nghĩa mô tả và lựa chọn chuẩn theo từng ngành hàng.</p></div><span className={styles.badge}>Chưa nối Backend</span></header>
      <aside className={styles.notice} aria-label="Giới hạn bản xem trước"><strong>{examples === undefined ? 'Chờ API quản trị thuộc tính.' : messages[state]}</strong><p>Không gửi yêu cầu, không lưu dữ liệu. Bộ lọc chỉ áp dụng mẫu trên trang; không có phân trang hoặc tổng toàn hệ thống. Bản xem trước không chứng minh phân quyền Admin.</p></aside>
      <div className={styles.category}><div><span className={styles.eyebrow}>NGÀNH HÀNG MINH HỌA</span><h2>Điện tử / Thiết bị mẫu</h2><p>Chỉ thuộc tính trực tiếp của ngành hàng này, không tự kế thừa từ cha.</p></div><button type="button" disabled>Đổi ngành hàng (chưa kết nối)</button></div>
      <form className={styles.filters} aria-label="Lọc thuộc tính minh họa" onSubmit={(event) => event.preventDefault()}>
        <label className={styles.field}>Tìm thuộc tính minh họa<input type="search" disabled={!interactive} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên hoặc slug" /></label>
        <label className={styles.field}>Trạng thái thuộc tính<select disabled={!interactive} value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Bật và tắt</option><option value="ACTIVE">Đang bật</option><option value="INACTIVE">Đã tắt</option></select></label>
        <label className={styles.field}>Lọc kiểu dữ liệu<select disabled={!interactive} value={kind} onChange={(event) => setKind(event.target.value)}><option value="ALL">Mọi kiểu</option>{kinds.map((item) => <option key={item} value={item}>{kindName[item]}</option>)}</select></label>
        <button type="button" disabled={!interactive} onClick={() => { setQuery(''); setStatus('ALL'); setKind('ALL'); }}>Xóa bộ lọc</button>
      </form>
      {!showExamples ? <section className={styles.empty} role="status"><h2>{examples === undefined ? 'Chờ kết nối dữ liệu thật' : state === 'loading' ? 'Đang tải · minh họa' : 'Không tải được · minh họa'}</h2><p>Chưa có số lượng thuộc tính hoặc số sản phẩm sử dụng từ Backend.</p></section> : <div className={styles.columns}>
        <section className={styles.panel} aria-label="Danh sách thuộc tính minh họa"><div className={styles.panelHeading}><h2>Thuộc tính</h2><span>{visible.length} / {examples.length} dòng mẫu</span></div>
          <div className={styles.list}>{visible.map((item) => <button className={styles.item} key={item.sampleKey} type="button" disabled={!interactive} aria-pressed={selectedKey === item.sampleKey} onClick={() => setSelectedKey(item.sampleKey)}>
            <strong>{item.name}</strong><span>{kindName[item.dataType]} · {item.isActive ? 'Bật' : 'Tắt'} · {item.isRequired ? 'Bắt buộc' : 'Tùy chọn'}</span><small>{usageText(item.usage)} · phiên bản mẫu {item.revision}</small>
          </button>)}{visible.length === 0 && <p className={styles.empty}>Không có thuộc tính minh họa phù hợp.</p>}</div>
          <div className={styles.footer}><button type="button" disabled={!interactive} aria-pressed={selectedKey === 'new'} onClick={() => setSelectedKey('new')}>+ Thêm thuộc tính minh họa</button></div>
        </section>
        <section className={styles.panel} aria-label="Trình soạn thuộc tính"><div className={styles.panelHeading}><h2>{example?.name ?? 'Thuộc tính mới'}</h2><span>{example ? usageText(example.usage) : 'Bản nháp chưa lưu'}</span></div>
          <div className={styles.editor}><p className={styles.hint}>Bản nháp chỉ giữ trong bộ nhớ khi chuyển thuộc tính. Tải lại hoặc đóng trang sẽ mất bản nháp. Danh sách không thay đổi theo form chưa lưu.</p>
            <AttributeEditor example={example} draft={draft} onChange={(next) => setDrafts({ ...drafts, [draftKey]: next })} disabled={!interactive} onPreview={preview} />
            {/* Retain each option draft, including when selecting a non-SELECT definition. */}
            {examples.filter((item) => item.dataType === 'SINGLE_SELECT').map((item) => <div key={item.sampleKey} hidden={item.sampleKey !== selectedKey || draft.dataType !== 'SINGLE_SELECT'}><OptionsEditor example={item} disabled={!interactive || item.sampleKey !== selectedKey} onPreview={preview} editorState={optionStates[item.sampleKey]} onStateChange={(next) => setOptionStates({ ...optionStates, [item.sampleKey]: next })} /></div>)}
            {draft.dataType !== 'SINGLE_SELECT' && <p className={styles.notice}>Kiểu này không có danh sách lựa chọn chuẩn.</p>}
            {draft.dataType === 'SINGLE_SELECT' && example?.dataType !== 'SINGLE_SELECT' && <p className={styles.notice}>Bản nháp mới: cần lưu định nghĩa ở trạng thái tắt trước khi thêm lựa chọn. Chưa có API nên bước này chưa thực hiện.</p>}
          </div><footer className={styles.footer}>Contract #65 đã merge; Backend quản trị đầy đủ chưa bàn giao. Không có nút xóa cứng hoặc tự sửa giá trị sản phẩm. Tìm không dấu chỉ là tiện ích lọc mẫu, không phải quy tắc tên trùng: tên chuẩn hóa vẫn giữ dấu.</footer>
        </section>
      </div>}
    </div>
    {modal && <ConfirmationPreview details={modal.details} opener={modal.opener} onClose={() => setConfirmation(null)} />}
  </section>;
}
