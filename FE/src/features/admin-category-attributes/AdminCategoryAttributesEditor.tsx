import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../services/apiClient';
import { createAttributeReadApi } from './attributeReadApi';
import type { AttributeDefinition, AttributeOption, AttributeReadApi } from './attributeReadApi';
import { createAttributeWriteApi, isUnknownWriteOutcome } from './attributeWriteApi';
import type { AttributeWriteApi, DefinitionInput, OptionInput } from './attributeWriteApi';
import styles from './AdminCategoryAttributesReader.module.css';
import editorStyles from './AdminCategoryAttributesEditor.module.css';

const defaultReadApi = createAttributeReadApi();
const defaultWriteApi = createAttributeWriteApi();
const emptyDefinition: DefinitionInput = { name: '', slug: '', dataType: 'TEXT', isRequired: false, isFilterable: false, allowsCustom: true, sortOrder: 0, isActive: false };
const emptyOption: OptionInput = { value: '', slug: '', sortOrder: 0, isActive: false };
const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : 'Không nhận được kết quả chắc chắn. Vui lòng kiểm tra lại trước khi tiếp tục.';
// Already loaded rows may include a newer successful local write. Do not replace
// them with an overlapping page read, or lose items inserted past the cursor.
function appendPage<T extends { id: number }>(previous: T[], incoming: T[]) {
  return [...new Map([...incoming, ...previous].map(row => [row.id, row])).values()].sort((a, b) => a.id - b.id);
}

export function AdminCategoryAttributesEditor({ categoryId, disabled = false, api = defaultWriteApi, reader = defaultReadApi, onLockChange }: {
  categoryId: number; disabled?: boolean; api?: AttributeWriteApi; reader?: AttributeReadApi; onLockChange?: (locked: boolean) => void;
}) {
  const [rows, setRows] = useState<AttributeDefinition[]>([]);
  const [selected, setSelected] = useState<AttributeDefinition | null>(null);
  const [options, setOptions] = useState<AttributeOption[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [optionCursor, setOptionCursor] = useState<number | null>(null);
  const [optionsStale, setOptionsStale] = useState(false);
  const [definition, setDefinition] = useState<DefinitionInput>(emptyDefinition);
  const [selectedOption, setSelectedOption] = useState<AttributeOption | null>(null);
  const [option, setOption] = useState<OptionInput>(emptyOption);
  const [definitionReason, setDefinitionReason] = useState('');
  const [definitionConfirmed, setDefinitionConfirmed] = useState(false);
  const [optionReason, setOptionReason] = useState('');
  const [optionConfirmed, setOptionConfirmed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState('');
  // Shared synchronous latch: React busy state alone cannot serialize same-tick events.
  const paging = useRef(false);
  const unknownWrite = useRef(false);
  function clearConsent() {
    setDefinitionReason(''); setDefinitionConfirmed(false);
    setOptionReason(''); setOptionConfirmed(false);
  }
  function changeDefinition(patch: Partial<DefinitionInput>) {
    if (paging.current || unknownWrite.current || disabled) return;
    setDefinition(previous => ({ ...previous, ...patch }));
    setDefinitionConfirmed(false);
  }
  function changeOption(patch: Partial<OptionInput>) {
    if (paging.current || unknownWrite.current || disabled) return;
    setOption(previous => ({ ...previous, ...patch }));
    setOptionConfirmed(false);
  }
  function chooseOption(row: AttributeOption | null) {
    if (paging.current || unknownWrite.current || disabled) return;
    setSelectedOption(row);
    setOption(row ? { value: row.value, slug: row.slug, sortOrder: row.sortOrder, isActive: row.isActive } : emptyOption);
    setOptionReason(''); setOptionConfirmed(false);
  }
  function newDefinition() {
    if (paging.current || unknownWrite.current || disabled) return;
    setSelected(null); setDefinition(emptyDefinition); setOptions([]);
    setOptionCursor(null); setOptionsStale(false); chooseOption(null); clearConsent();
  }
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => onLockChange?.(locked), [locked, onLockChange]);
  const load = useCallback(async (afterId?: number) => {
    if (paging.current || disabled) return;
    paging.current = true;
    setBusy(true); setNotice('');
    try {
      const page = await reader.list(categoryId, { limit: 100, ...(afterId === undefined ? {} : { afterId }) });
      if (mounted.current) {
        setRows(previous => afterId === undefined ? page.items : appendPage(previous, page.items));
        setNextCursor(page.nextCursor);
      }
    } catch (error) { if (mounted.current) setNotice(errorMessage(error)); }
    finally { paging.current = false; if (mounted.current) setBusy(false); }
  }, [categoryId, reader, disabled]);
  useEffect(() => {
    let current = true;
    paging.current = true;
    void reader.list(categoryId, { limit: 100 }).then(page => { if (current) { setRows(page.items); setNextCursor(page.nextCursor); } })
      .catch(error => { if (current) setNotice(errorMessage(error)); })
      .finally(() => { if (current) { paging.current = false; setBusy(false); } });
    return () => { current = false; };
  }, [categoryId, reader]);
  async function choose(row: AttributeDefinition) {
    if (locked || unknownWrite.current || busy || disabled || paging.current) return;
    paging.current = true;
    setBusy(true); setNotice('');
    try {
      const detail = await reader.detail(categoryId, row.id);
      const optionPage = detail.dataType === 'SINGLE_SELECT' ? await reader.options(categoryId, row.id, { limit: 100 }) : { items: [], nextCursor: null, definitionRevision: detail.revision };
      if (!mounted.current) return;
      if (optionPage.definitionRevision !== detail.revision) throw new ApiError('Thuộc tính đã đổi phiên bản. Chọn lại thuộc tính để đọc dữ liệu mới.', 409, 'ATTRIBUTE_REVISION_CONFLICT');
      setSelected(detail); setDefinition({ name: detail.name, slug: detail.slug, dataType: detail.dataType, isRequired: detail.isRequired, isFilterable: detail.isFilterable, allowsCustom: detail.allowsCustom, sortOrder: detail.sortOrder, isActive: detail.isActive });
      setOptions(optionPage.items); setOptionCursor(optionPage.nextCursor); setOptionsStale(false);
      setSelectedOption(null); setOption(emptyOption); clearConsent();
    } catch (error) { if (mounted.current) setNotice(errorMessage(error)); }
    finally { paging.current = false; if (mounted.current) setBusy(false); }
  }
  async function moreOptions() {
    if (!selected || optionCursor === null || busy || disabled || locked || optionsStale || paging.current) return;
    paging.current = true; setBusy(true); setNotice('');
    try {
      const page = await reader.options(categoryId, selected.id, { limit: 100, afterId: optionCursor });
      if (!mounted.current) return;
      if (page.definitionRevision !== selected.revision) {
        setOptionsStale(true);
        return;
      }
      setOptions(previous => appendPage(previous, page.items)); setOptionCursor(page.nextCursor);
    } catch (error) { if (mounted.current) setNotice(errorMessage(error)); }
    finally { paging.current = false; if (mounted.current) setBusy(false); }
  }
  function policyChanged() { return !!selected && (definition.isActive !== selected.isActive || definition.isRequired !== selected.isRequired || definition.allowsCustom !== selected.allowsCustom); }
  async function perform(work: () => Promise<{ definition: AttributeDefinition; option: AttributeOption | null }>, success: string) {
    if (busy || locked || unknownWrite.current || disabled || optionsStale || paging.current) return;
    paging.current = true;
    setBusy(true); setNotice('');
    try {
      const result = await work();
      if (!mounted.current) return;
      setSelected(result.definition); setDefinition({ name: result.definition.name, slug: result.definition.slug, dataType: result.definition.dataType, isRequired: result.definition.isRequired, isFilterable: result.definition.isFilterable, allowsCustom: result.definition.allowsCustom, sortOrder: result.definition.sortOrder, isActive: result.definition.isActive });
      if (result.option) {
        setOptions(previous => [...previous.filter(row => row.id !== result.option!.id), result.option!].sort((a,b) => a.id-b.id));
        setSelectedOption(result.option); setOption({ value: result.option.value, slug: result.option.slug, sortOrder: result.option.sortOrder, isActive: result.option.isActive });
      }
      setRows(previous => [...previous.filter(row => row.id !== result.definition.id), result.definition].sort((a,b) => a.id-b.id));
      clearConsent(); setNotice(success);
    } catch (error) {
      if (!mounted.current) return;
      setNotice(errorMessage(error));
      if (isUnknownWriteOutcome(error)) { unknownWrite.current = true; setLocked(true); }
      // Drafts deliberately remain untouched on known validation/conflict errors.
    } finally { paging.current = false; if (mounted.current) setBusy(false); }
  }
  const definitionPolicy = policyChanged() || (!selected && definition.isActive && definition.isRequired);
  const optionPolicy = !!selectedOption && selectedOption.isActive !== option.isActive;
  const validReason = (reason: string) => [...reason.normalize('NFC').trim()].length >= 10 && [...reason.normalize('NFC').trim()].length <= 500;
  const definitionConsentValid = definitionConfirmed && validReason(definitionReason);
  const optionConsentValid = optionConfirmed && validReason(optionReason);
  const confirmation = () => policyChanged() ? { confirmPolicyChange: true as const, reason: definitionReason } : {};
  const saveDefinition = () => {
    if (definitionPolicy && !definitionConsentValid) return;
    return perform(() => selected
    ? api.patchDefinition(categoryId, selected.id, { ...definition, expectedRevision: selected.revision, ...confirmation() })
    : api.createDefinition(categoryId, { ...definition, ...(definition.isActive && definition.isRequired ? { confirmPolicyChange: true as const, reason: definitionReason } : {}) }), selected ? 'Đã cập nhật thuộc tính.' : 'Đã tạo thuộc tính.');
  };
  const saveOption = () => {
    if (!selected || (optionPolicy && !optionConsentValid)) return;
    void perform(() => selectedOption
      ? api.patchOption(categoryId, selected.id, selectedOption.id, { ...option, expectedRevision: selected.revision, ...(optionPolicy ? { confirmPolicyChange: true as const, reason: optionReason } : {}) })
      : api.createOption(categoryId, selected.id, { ...option, expectedRevision: selected.revision }), selectedOption ? 'Đã cập nhật lựa chọn.' : 'Đã tạo lựa chọn.');
  };
  const formDisabled = disabled || busy || locked;
  return <section className={`${styles.root} ${editorStyles.editor}`} aria-label="Quản lý thuộc tính ngành hàng">
    <h1>Thuộc tính ngành hàng #{categoryId}</h1>
    <p>Chọn thuộc tính để cập nhật thông tin và các lựa chọn của sản phẩm.</p>
    {locked && <p role="alert">Chưa xác định được kết quả lưu trước đó. Tạm khóa chỉnh sửa để tránh cập nhật trùng; hãy kiểm tra kết quả trước khi tiếp tục.</p>}
    {optionsStale && <p role="alert">Phiên bản thuộc tính đã thay đổi. Bản nháp được giữ; chọn lại thuộc tính để đọc phiên bản mới trước khi lưu.</p>}
    {notice && <p role={notice.startsWith('Đã ') ? 'status' : 'alert'}>{notice}</p>}
    <button disabled={disabled || busy} onClick={() => void load()}>Tải lại danh sách</button>
    <div className={styles.columns}><section><h2>Danh sách</h2>
      <p>Đã tải {rows.length} thuộc tính{nextCursor !== null ? ' — còn trang tiếp theo.' : ' — hết trang tại lần đọc này.'} Danh sách có thể thay đổi giữa các lần tải.</p>
      {rows.map(row => <button className={styles.row} disabled={formDisabled} key={row.id} onClick={() => void choose(row)}>{row.name} · v{row.revision} · {row.isActive ? 'Bật' : 'Tắt'}</button>)}
      {nextCursor !== null && <button disabled={disabled || busy} onClick={() => void load(nextCursor)}>Tải thêm thuộc tính</button>}
      <button disabled={formDisabled} onClick={newDefinition}>+ Thuộc tính mới</button>
    </section><section><h2>{selected ? `Sửa ${selected.name}` : 'Tạo thuộc tính'}</h2>
      <label>Tên <input disabled={formDisabled} value={definition.name} onChange={e => changeDefinition({name:e.target.value})}/></label>
      <label>Slug <input disabled={formDisabled} value={definition.slug} onChange={e => changeDefinition({slug:e.target.value})}/></label>
      <label>Kiểu <select disabled={formDisabled || !!selected} value={definition.dataType} onChange={e => changeDefinition({dataType:e.target.value as DefinitionInput['dataType']})}>{['TEXT','NUMBER','BOOLEAN','SINGLE_SELECT'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Thứ tự <input disabled={formDisabled} type="number" min="0" value={definition.sortOrder} onChange={e => changeDefinition({sortOrder:Number(e.target.value)})}/></label>
      <p><label><input disabled={formDisabled} type="checkbox" checked={definition.isActive} onChange={e => changeDefinition({isActive:e.target.checked})}/> Bật</label>{' '}<label><input disabled={formDisabled} type="checkbox" checked={definition.isRequired} onChange={e => changeDefinition({isRequired:e.target.checked})}/> Bắt buộc</label>{' '}<label><input disabled={formDisabled} type="checkbox" checked={definition.isFilterable} onChange={e => changeDefinition({isFilterable:e.target.checked})}/> Có thể lọc</label>{' '}<label><input disabled={formDisabled || definition.dataType !== 'SINGLE_SELECT'} type="checkbox" checked={definition.allowsCustom} onChange={e => changeDefinition({allowsCustom:e.target.checked})}/> Cho nhập ngoài</label></p>
      {definitionPolicy && <><label>Lý do xác nhận chính sách <textarea disabled={formDisabled} value={definitionReason} onChange={e => { if (paging.current || unknownWrite.current || disabled) return; setDefinitionReason(e.target.value); setDefinitionConfirmed(false); }} /></label><label><input disabled={formDisabled} type="checkbox" checked={definitionConfirmed} onChange={e => { if (paging.current || unknownWrite.current || disabled) return; setDefinitionConfirmed(e.target.checked); }}/> Tôi xác nhận thay đổi chính sách này</label></>}
      <button disabled={formDisabled || optionsStale || !definition.name || !definition.slug || (definitionPolicy && !definitionConsentValid)} onClick={() => void saveDefinition()}>Lưu thuộc tính</button>
      {selected?.dataType === 'SINGLE_SELECT' && <section><h3>Lựa chọn</h3>{options.map(row => <button className={styles.row} disabled={formDisabled} key={row.id} onClick={() => chooseOption(row)}>{row.value} · {row.isActive ? 'Bật' : 'Tắt'}</button>)}
        <p>Đã tải {options.length} lựa chọn{optionCursor !== null ? ' — còn trang tiếp theo.' : ' — hết trang tại lần đọc này.'}</p>
        {optionCursor !== null && <button disabled={formDisabled || optionsStale} onClick={() => void moreOptions()}>Tải thêm lựa chọn</button>}
        <button disabled={formDisabled} onClick={() => chooseOption(null)}>+ Lựa chọn mới</button>
        <label>Giá trị <input disabled={formDisabled} value={option.value} onChange={e => changeOption({value:e.target.value})}/></label><label>Slug <input disabled={formDisabled} value={option.slug} onChange={e => changeOption({slug:e.target.value})}/></label><label>Thứ tự <input disabled={formDisabled} type="number" min="0" value={option.sortOrder} onChange={e => changeOption({sortOrder:Number(e.target.value)})}/></label><label><input disabled={formDisabled} type="checkbox" checked={option.isActive} onChange={e => changeOption({isActive:e.target.checked})}/> Bật</label>
        {optionPolicy && <><label>Lý do đổi trạng thái lựa chọn <textarea disabled={formDisabled} value={optionReason} onChange={e => { if (paging.current || unknownWrite.current || disabled) return; setOptionReason(e.target.value); setOptionConfirmed(false); }} /></label><label><input disabled={formDisabled} type="checkbox" checked={optionConfirmed} onChange={e => { if (paging.current || unknownWrite.current || disabled) return; setOptionConfirmed(e.target.checked); }}/> Tôi xác nhận đổi trạng thái lựa chọn</label></>}
        <button disabled={formDisabled || optionsStale || !option.value || !option.slug || (optionPolicy && !optionConsentValid)} onClick={saveOption}>Lưu lựa chọn</button>
      </section>}
    </section></div>
  </section>;
}
