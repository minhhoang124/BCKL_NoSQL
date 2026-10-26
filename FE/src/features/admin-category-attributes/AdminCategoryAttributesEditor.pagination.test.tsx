// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminCategoryAttributesEditor } from './AdminCategoryAttributesEditor';
import type { AttributeDefinition, AttributeOption, AttributeReadApi } from './attributeReadApi';
import type { AttributeWriteApi } from './attributeWriteApi';

const definition: AttributeDefinition = { id: 7, categoryId: 3, name: 'Màu sắc', slug: 'mau-sac', dataType: 'SINGLE_SELECT', isRequired: false, isFilterable: false, allowsCustom: true, sortOrder: 0, isActive: false, revision: 4, createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z', usage: { referencedProductCount: 0 } };
const definitions = Array.from({length:100}, (_,i) => ({ ...definition, id:i+1, name:i===6?definition.name:`Attribute ${i+1}`, slug:`attr-${i+1}` }));
const options: AttributeOption[] = Array.from({length:100},(_,i)=>({id:i+1,attributeDefinitionId:7,value:`Option ${i+1}`,slug:`option-${i+1}`,sortOrder:0,isActive:false,referencedProductCount:0}));
function reader(): AttributeReadApi {
  return {list:vi.fn().mockResolvedValue({items:definitions,nextCursor:100}),detail:vi.fn().mockResolvedValue(definition),options:vi.fn().mockResolvedValue({items:options,nextCursor:100,definitionRevision:4})};
}
async function choose() {
  fireEvent.click(await screen.findByRole('button',{name:/Màu sắc · v4/}));
  await screen.findByRole('heading',{name:'Sửa Màu sắc'});
}
afterEach(cleanup);

describe('Attributes editor pagination',()=>{
  it('appends definitions past100 while preserving the selected draft and hiding exhausted cursor',async()=>{
    const api=reader();vi.mocked(api.list).mockResolvedValueOnce({items:definitions,nextCursor:100}).mockResolvedValueOnce({items:[{...definition,id:101,name:'Last attribute'}],nextCursor:null});
    render(<AdminCategoryAttributesEditor categoryId={3} reader={api}/>);await choose();
    fireEvent.change(screen.getByLabelText('Tên'),{target:{value:'Unsaved definition'}});
    fireEvent.click(screen.getByRole('button',{name:'Tải thêm thuộc tính'}));
    await screen.findByRole('button',{name:/Last attribute · v4/});
    expect(api.list).toHaveBeenLastCalledWith(3,{limit:100,afterId:100});
    expect(screen.getByLabelText('Tên')).toHaveValue('Unsaved definition');
    expect(screen.queryByRole('button',{name:'Tải thêm thuộc tính'})).not.toBeInTheDocument();
  });
  it('preserves rows/cursor/draft on failed page read and allows a deliberate retry',async()=>{
    const api=reader();vi.mocked(api.list).mockResolvedValueOnce({items:definitions,nextCursor:100}).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({items:[],nextCursor:null});
    render(<AdminCategoryAttributesEditor categoryId={3} reader={api}/>);await choose();
    fireEvent.change(screen.getByLabelText('Tên'),{target:{value:'Keep draft'}});
    fireEvent.click(screen.getByRole('button',{name:'Tải thêm thuộc tính'}));
    await screen.findByRole('alert');
    expect(screen.getByRole('button',{name:/Attribute 100 ·/})).toBeEnabled();expect(screen.getByLabelText('Tên')).toHaveValue('Keep draft');
    fireEvent.click(screen.getByRole('button',{name:'Tải thêm thuộc tính'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Tải thêm thuộc tính'})).not.toBeInTheDocument());
    expect(api.list).toHaveBeenLastCalledWith(3,{limit:100,afterId:100});
  });
  it('appends options past100 without changing the option draft',async()=>{
    const api=reader();vi.mocked(api.options).mockResolvedValueOnce({items:options,nextCursor:100,definitionRevision:4}).mockResolvedValueOnce({items:[{...options[0],id:101,value:'Last option'}],nextCursor:null,definitionRevision:4});
    render(<AdminCategoryAttributesEditor categoryId={3} reader={api}/>);await choose();
    fireEvent.click(screen.getByRole('button',{name:'Option 1 · Tắt'}));fireEvent.change(screen.getByLabelText('Giá trị'),{target:{value:'Unsaved option'}});
    fireEvent.click(screen.getByRole('button',{name:'Tải thêm lựa chọn'}));await screen.findByRole('button',{name:'Last option · Tắt'});
    expect(api.options).toHaveBeenLastCalledWith(3,7,{limit:100,afterId:100});expect(screen.getByLabelText('Giá trị')).toHaveValue('Unsaved option');
    expect(screen.queryByRole('button',{name:'Tải thêm lựa chọn'})).not.toBeInTheDocument();
  });
  it('keeps loaded options and allows retry after read failure',async()=>{
    const api=reader();vi.mocked(api.options).mockResolvedValueOnce({items:options,nextCursor:100,definitionRevision:4}).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({items:[],nextCursor:null,definitionRevision:4});
    render(<AdminCategoryAttributesEditor categoryId={3} reader={api}/>);await choose();fireEvent.click(screen.getByRole('button',{name:'Tải thêm lựa chọn'}));await screen.findByRole('alert');
    expect(screen.getByRole('button',{name:'Option 100 · Tắt'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Tải thêm lựa chọn'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Tải thêm lựa chọn'})).not.toBeInTheDocument());
  });
  it('rejects mixed revisions, retains draft and blocks saving until deliberate re-selection',async()=>{
    const api=reader();vi.mocked(api.detail).mockResolvedValueOnce(definition).mockResolvedValueOnce({...definition,revision:5});
    vi.mocked(api.options).mockResolvedValueOnce({items:options,nextCursor:100,definitionRevision:4}).mockResolvedValueOnce({items:[{...options[0],id:101,value:'Stale page'}],nextCursor:null,definitionRevision:5}).mockResolvedValueOnce({items:options,nextCursor:null,definitionRevision:5});
    render(<AdminCategoryAttributesEditor categoryId={3} reader={api}/>);await choose();
    fireEvent.click(screen.getByRole('button',{name:'Option 1 · Tắt'}));fireEvent.change(screen.getByLabelText('Giá trị'),{target:{value:'Retained option draft'}});
    fireEvent.click(screen.getByRole('button',{name:'Tải thêm lựa chọn'}));await screen.findByText(/Phiên bản thuộc tính đã thay đổi/);
    expect(screen.getByLabelText('Giá trị')).toHaveValue('Retained option draft');expect(screen.queryByRole('button',{name:'Stale page · Tắt'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Lưu lựa chọn'})).toBeDisabled();expect(screen.getByRole('button',{name:'Lưu thuộc tính'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:/Màu sắc · v4/}));await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu thuộc tính'})).toBeEnabled());
  });
  it('rejects a first option page whose parent revision differs from detail',async()=>{
    const api=reader();vi.mocked(api.options).mockResolvedValue({items:options,nextCursor:null,definitionRevision:5});
    render(<AdminCategoryAttributesEditor categoryId={3} reader={api}/>);fireEvent.click(await screen.findByRole('button',{name:/Màu sắc · v4/}));
    await screen.findByText(/ATTRIBUTE_REVISION_CONFLICT/);expect(screen.queryByRole('heading',{name:'Sửa Màu sắc'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Option 1 · Tắt'})).not.toBeInTheDocument();
  });
  it('deduplicates a newly created definition also returned in a later page',async()=>{
    const api=reader(),created={...definition,id:101,name:'Created locally'};
    vi.mocked(api.list).mockResolvedValueOnce({items:definitions,nextCursor:100}).mockResolvedValueOnce({items:[{...created,name:'Older read'}],nextCursor:null});
    const writer:AttributeWriteApi={createDefinition:vi.fn().mockResolvedValue({definition:created,option:null}),patchDefinition:vi.fn(),createOption:vi.fn(),patchOption:vi.fn()};
    render(<AdminCategoryAttributesEditor categoryId={3} reader={api} api={writer}/>);await screen.findByRole('button',{name:/Màu sắc · v4/});
    fireEvent.change(screen.getByLabelText('Tên'),{target:{value:'Created locally'}});fireEvent.change(screen.getByLabelText('Slug'),{target:{value:'created'}});
    fireEvent.click(screen.getByRole('button',{name:'Lưu thuộc tính'}));await screen.findByText('Đã tạo thuộc tính.');
    fireEvent.click(screen.getByRole('button',{name:'Tải thêm thuộc tính'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'Tải thêm thuộc tính'})).not.toBeInTheDocument());
    expect(screen.getAllByRole('button',{name:/Created locally ·/})).toHaveLength(1);expect(screen.queryByRole('button',{name:/Older read ·/})).not.toBeInTheDocument();
  });
});
