// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminCategoryAttributesEditor } from './AdminCategoryAttributesEditor';
import type { AttributeDefinition, AttributeReadApi } from './attributeReadApi';
import type { AttributeWriteApi } from './attributeWriteApi';

const row:AttributeDefinition={id:7,categoryId:3,name:'Màu sắc',slug:'mau-sac',dataType:'SINGLE_SELECT',isActive:false,isRequired:false,isFilterable:false,allowsCustom:true,sortOrder:0,revision:4,createdAt:'2026-10-23T00:00:00.000Z',updatedAt:'2026-10-23T00:00:00.000Z',usage:{referencedProductCount:0}};
const choices=[11,12].map(id=>({id,attributeDefinitionId:7,value:`Option ${id}`,slug:`option-${id}`,sortOrder:0,isActive:false,referencedProductCount:0}));
const reasonDefinition='Bật thuộc tính để sử dụng cho danh mục';
const reasonOption='Bật lựa chọn này cho sản phẩm trong danh mục';
async function setup(){
 const reader:AttributeReadApi={list:vi.fn().mockResolvedValue({items:[row],nextCursor:null}),detail:vi.fn().mockResolvedValue(row),options:vi.fn().mockResolvedValue({items:choices,nextCursor:null,definitionRevision:4})};
 const api:AttributeWriteApi={createDefinition:vi.fn(),patchDefinition:vi.fn().mockResolvedValue({definition:{...row,revision:5,isActive:true},option:null}),createOption:vi.fn(),patchOption:vi.fn().mockResolvedValue({definition:{...row,revision:5},option:{...choices[0],isActive:true}})};
 render(<AdminCategoryAttributesEditor categoryId={3} reader={reader} api={api}/>);
 fireEvent.click(await screen.findByRole('button',{name:/Màu sắc · v4/}));await screen.findByRole('button',{name:'Option 11 · Tắt'});
 return api;
}
function enableDefinition(){fireEvent.click(screen.getAllByRole('checkbox',{name:'Bật'})[0]);}
function enableOption(){fireEvent.click(screen.getAllByRole('checkbox',{name:'Bật'})[1]);}
function confirmDefinition(){fireEvent.change(screen.getByLabelText('Lý do xác nhận chính sách'),{target:{value:reasonDefinition}});fireEvent.click(screen.getByRole('checkbox',{name:'Tôi xác nhận thay đổi chính sách này'}));}
function confirmOption(){fireEvent.change(screen.getByLabelText('Lý do đổi trạng thái lựa chọn'),{target:{value:reasonOption}});fireEvent.click(screen.getByRole('checkbox',{name:'Tôi xác nhận đổi trạng thái lựa chọn'}));}
afterEach(cleanup);
describe('Attributes policy consent belongs to its command',()=>{
 it('does not reuse definition consent/reason for an option command',async()=>{
  const api=await setup();enableDefinition();confirmDefinition();fireEvent.click(screen.getByRole('button',{name:'Option 11 · Tắt'}));enableOption();
  expect(screen.getByRole('checkbox',{name:'Tôi xác nhận đổi trạng thái lựa chọn'})).not.toBeChecked();expect(screen.getByLabelText('Lý do đổi trạng thái lựa chọn')).toHaveValue('');
  expect(screen.getByRole('button',{name:'Lưu lựa chọn'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Lưu lựa chọn'}));expect(api.patchOption).not.toHaveBeenCalled();
 });
 it('does not reuse option consent/reason for a definition command',async()=>{
  const api=await setup();fireEvent.click(screen.getByRole('button',{name:'Option 11 · Tắt'}));enableOption();confirmOption();enableDefinition();
  expect(screen.getByRole('checkbox',{name:'Tôi xác nhận thay đổi chính sách này'})).not.toBeChecked();expect(screen.getByLabelText('Lý do xác nhận chính sách')).toHaveValue('');
  expect(screen.getByRole('button',{name:'Lưu thuộc tính'})).toBeDisabled();expect(api.patchDefinition).not.toHaveBeenCalled();
 });
 it('requires new consent when the option target changes',async()=>{
  await setup();fireEvent.click(screen.getByRole('button',{name:'Option 11 · Tắt'}));enableOption();confirmOption();fireEvent.click(screen.getByRole('button',{name:'Option 12 · Tắt'}));enableOption();
  expect(screen.getByRole('checkbox',{name:'Tôi xác nhận đổi trạng thái lựa chọn'})).not.toBeChecked();expect(screen.getByLabelText('Lý do đổi trạng thái lựa chọn')).toHaveValue('');expect(screen.getByRole('button',{name:'Lưu lựa chọn'})).toBeDisabled();
 });
 it('invalidates definition consent when policy changes, including changing back',async()=>{
  await setup();enableDefinition();confirmDefinition();fireEvent.click(screen.getByRole('checkbox',{name:'Bắt buộc'}));
  expect(screen.getByRole('checkbox',{name:'Tôi xác nhận thay đổi chính sách này'})).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox',{name:'Bắt buộc'}));expect(screen.getByRole('button',{name:'Lưu thuộc tính'})).toBeDisabled();
 });
 it('invalidates option consent when option content changes',async()=>{
  await setup();fireEvent.click(screen.getByRole('button',{name:'Option 11 · Tắt'}));enableOption();confirmOption();fireEvent.change(screen.getByLabelText('Giá trị'),{target:{value:'Changed after consent'}});
  expect(screen.getByRole('checkbox',{name:'Tôi xác nhận đổi trạng thái lựa chọn'})).not.toBeChecked();expect(screen.getByRole('button',{name:'Lưu lựa chọn'})).toBeDisabled();
 });
 it('sends only the independently confirmed option reason and target',async()=>{
  const api=await setup();enableDefinition();confirmDefinition();fireEvent.click(screen.getByRole('button',{name:'Option 11 · Tắt'}));enableOption();confirmOption();fireEvent.click(screen.getByRole('button',{name:'Lưu lựa chọn'}));
  await screen.findByText('Đã cập nhật lựa chọn.');expect(api.patchOption).toHaveBeenCalledExactlyOnceWith(3,7,11,expect.objectContaining({expectedRevision:4,isActive:true,confirmPolicyChange:true,reason:reasonOption}));expect(api.patchDefinition).not.toHaveBeenCalled();
 });
});
