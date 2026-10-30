"""Native Chrome Seller closing acceptance; private synthetic fixture, no provider calls."""
import argparse,json,sys
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('--fixture',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
workspace=Path(__file__).resolve().parents[2];sys.path.insert(0,str(workspace/'machine-local/qa-tools/python'))
from playwright.sync_api import sync_playwright
fixture=json.loads(Path(args.fixture).read_text(encoding='utf-8'));out=Path(args.output);web=fixture['web'];api=fixture['api']
assert web=='http://127.0.0.1:5198' and api.startswith('http://127.0.0.1:')
report={'result':'RUNNING','checks':[]};errors=[];writes=[]

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
 context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page();page.set_default_timeout(25000)
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda r:writes.append({'url':r.url,'key':r.headers.get('idempotency-key')}) if r.method=='POST' and '/seller/orders/' in r.url else None)
 journal='bckl-seller-close-v1:'+str(fixture['actors']['SELLER']['id'])
 def login(target,actor):
  target.goto(web+'/login');target.wait_for_load_state('networkidle');target.get_by_label('Email',exact=True).fill(actor['email']);target.get_by_label('Mật khẩu',exact=True).fill(actor['password']);target.get_by_role('button',name='Đăng nhập',exact=True).click();target.wait_for_url(lambda u:'/login' not in u)
 def open_order(order):
  page.goto(web+f'/seller/orders/{order["id"]}/close');page.wait_for_load_state('networkidle');page.get_by_role('heading',name='Đơn ORD-',exact=False).wait_for()
 def fill(order,changed=False):
  if order['name'] in ('restock','damaged','resolve-committed'):
   page.get_by_label('Tình trạng hàng đã nhận',exact=True).select_option('restock' if order['name']=='restock' else 'damaged')
   page.get_by_label('Biên nhận hàng quay về',exact=True).fill('QA-RECEIPT-'+str(order['id']))
   assert page.get_by_label('Tình trạng hàng đã nhận',exact=True).locator('option[value="LOST"]').count()==0
  else:page.get_by_label('Lý do hủy',exact=True).select_option('OTHER')
  page.get_by_label('Mô tả lý do',exact=True).fill(('changed-' if changed else '')+'QA '+order['name'])
 def consent():page.get_by_role('checkbox',name='Tôi đã kiểm tra đúng đơn',exact=False).check()
 def complete(order):
  command='confirm-returned' if order['name'] in ('restock','damaged') else 'cancel';endpoint=api+f'/seller/orders/{order["id"]}/{command}';before=len(writes)
  fill(order);assert not page.get_by_role('button',name='Xác nhận hủy/nhận hoàn',exact=True).is_enabled();consent()
  with page.expect_response(lambda r:r.url==endpoint and r.request.method=='POST') as response:
   page.get_by_role('button',name='Xác nhận hủy/nhận hoàn',exact=True).evaluate('(b)=>{b.click();b.click()}')
  assert response.value.status==200;page.get_by_text('Đã xác minh biên nhận hủy/nhận hoàn.',exact=False).wait_for();assert len(writes)==before+1
  assert page.evaluate('(k)=>sessionStorage.getItem(k)',journal) is None
  body=response.value.request.post_data_json
  if order['name']=='damaged':assert body['restockable'] is False and body['reasonCode']=='DAMAGED'
  page.get_by_role('button',name='Tải lại đơn để đối chiếu',exact=True).click();page.get_by_text('Không có thao tác hủy/nhận hoàn phù hợp',exact=False).wait_for()
 try:
  login(page,fixture['actors']['SELLER'])
  for order in (o for o in fixture['orders'] if o['name'] in ('pending','confirmed','restock','damaged','lost-response')):
   page.set_viewport_size({'width':390,'height':844} if order['name']=='restock' else {'width':1440,'height':1000});page.emulate_media(color_scheme='dark' if order['name']=='restock' else 'light')
   open_order(order);before=len(writes)
   if order['name']=='lost-response':
    endpoint=api+f'/seller/orders/{order["id"]}/cancel';keys=[]
    def lose(route):
     keys.append(route.request.headers['idempotency-key']);response=route.fetch();assert response.status==200;route.abort('failed')
    page.route(endpoint,lose);fill(order);consent();page.get_by_role('button',name='Xác nhận hủy/nhận hoàn',exact=True).click();page.get_by_role('alert').wait_for();page.unroute(endpoint,lose)
    assert len(keys)==1
    saved=json.loads(page.evaluate('(k)=>sessionStorage.getItem(k)',journal));assert set(saved)=={'schemaVersion','actorId','orderId','command','idempotencyKey','requestHash'}
    assert saved['orderId']==order['id'] and saved['idempotencyKey']==keys[0]
    page.reload();page.wait_for_load_state('networkidle');page.get_by_role('button',name='Gửi lại cùng yêu cầu Seller',exact=True).wait_for();assert len(writes)==before+1
    fill(order,changed=True);consent();page.get_by_role('button',name='Gửi lại cùng yêu cầu Seller',exact=True).click();page.get_by_role('alert').wait_for();assert len(writes)==before+1
    fill(order);consent()
    with page.expect_response(lambda r:r.url==endpoint and r.request.method=='POST') as response:page.get_by_role('button',name='Gửi lại cùng yêu cầu Seller',exact=True).click()
    assert response.value.status==200 and response.value.json()['replayed'] is True;assert response.value.request.headers['idempotency-key']==keys[0]
    page.get_by_text('Đã xác minh biên nhận hủy/nhận hoàn.',exact=False).wait_for();assert page.evaluate('(k)=>sessionStorage.getItem(k)',journal) is None;assert len(writes)==before+2
   else:complete(order)
   page.screenshot(path=str(out/(order['name']+'.png')),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   report['checks'].append({'name':order['name'],'result':'PASS','orderId':order['id']})
  # Recover a real committed DAMAGED return without re-entering any old fields.
  committed_order=next(o for o in fixture['orders'] if o['name']=='resolve-committed');open_order(committed_order);before=len(writes)
  endpoint=api+f'/seller/orders/{committed_order["id"]}/confirm-returned';lost_keys=[]
  def lose_return(route):
   lost_keys.append(route.request.headers['idempotency-key']);response=route.fetch();assert response.status==200;assert response.json()['result']['restockable'] is False;route.abort('failed')
  page.route(endpoint,lose_return);fill(committed_order);consent();page.get_by_role('button',name='Xác nhận hủy/nhận hoàn',exact=True).click();page.get_by_role('alert').wait_for();page.unroute(endpoint,lose_return)
  assert len(lost_keys)==1;page.reload();page.wait_for_load_state('networkidle');page.get_by_role('button',name='Mở đối chiếu mã yêu cầu',exact=True).wait_for();assert len(writes)==before+1
  page.get_by_role('button',name='Mở đối chiếu mã yêu cầu',exact=True).click();page.get_by_role('checkbox',name='Tôi đồng ý đối chiếu',exact=False).check()
  with page.expect_response(lambda r:r.url==api+f'/seller/orders/{committed_order["id"]}/resolve-close-command' and r.request.method=='POST') as resolved:page.get_by_role('button',name='Đối chiếu / dừng mã yêu cầu',exact=True).click()
  assert resolved.value.status==200 and resolved.value.json()['outcome']=='COMMITTED';assert resolved.value.json()['receipt']['result']['restockable'] is False;assert resolved.value.request.headers['idempotency-key']==lost_keys[0]
  page.get_by_text('Đã đối chiếu biên nhận đã thực hiện.',exact=False).wait_for();assert page.evaluate('(k)=>sessionStorage.getItem(k)',journal) is None;assert len(writes)==before+2
  page.screenshot(path=str(out/'resolve-committed.png'),full_page=True);report['checks'].append({'name':'explicit-resolve-COMMITTED-without-body-damaged-false','result':'PASS','orderId':committed_order['id']})
  foreign=next(o for o in fixture['orders'] if o['name']=='foreign');before=len(writes);page.goto(web+f'/seller/orders/{foreign["id"]}/close');page.get_by_role('alert').wait_for();assert page.get_by_role('button',name='Xác nhận hủy/nhận hoàn',exact=True).count()==0;assert len(writes)==before
  report['checks'].append({'name':'foreign-store-ui-no-command','result':'PASS','orderId':foreign['id']})
  for name in ('shipping','paid-negative','completed'):
   order=next(o for o in fixture['orders'] if o['name']==name);open_order(order);page.get_by_text('Không có thao tác hủy/nhận hoàn phù hợp',exact=False).wait_for();assert page.get_by_role('button',name='Xác nhận hủy/nhận hoàn',exact=True).count()==0
   report['checks'].append({'name':name+'-ui-denied','result':'PASS','orderId':order['id']})
  unresolved=next(o for o in fixture['orders'] if o['name']=='resolve-browser');metadata=fixture['browserResolution']
  page.evaluate('([k,v])=>sessionStorage.setItem(k,JSON.stringify(v))',[journal,metadata]);before=len(writes);open_order(unresolved)
  page.get_by_role('button',name='Mở đối chiếu mã yêu cầu',exact=True).click();resolve_button=page.get_by_role('button',name='Đối chiếu / dừng mã yêu cầu',exact=True);assert not resolve_button.is_enabled();assert len(writes)==before
  page.get_by_role('checkbox',name='Tôi đồng ý đối chiếu',exact=False).check()
  with page.expect_response(lambda r:r.url==api+f'/seller/orders/{unresolved["id"]}/resolve-close-command' and r.request.method=='POST') as resolution:resolve_button.evaluate('(b)=>{b.click();b.click()}')
  assert resolution.value.status==200 and resolution.value.json()['outcome']=='CLOSED_WITHOUT_EXECUTION';assert resolution.value.request.headers['idempotency-key']==metadata['idempotencyKey'];assert len(writes)==before+1
  page.get_by_text('Đã đóng mã yêu cầu chưa thực hiện.',exact=False).wait_for();assert page.evaluate('(k)=>sessionStorage.getItem(k)',journal) is None
  page.screenshot(path=str(out/'resolve-closed.png'),full_page=True);report['checks'].append({'name':'explicit-resolve-unexecuted-CLOSED','result':'PASS','orderId':unresolved['id']})
  for role in ('USER','ADMIN'):
   other=browser.new_context();target=other.new_page();target.set_default_timeout(25000);login(target,fixture['actors'][role]);target.goto(web+f'/seller/orders/{fixture["orders"][0]["id"]}/close');target.wait_for_url(web+'/');assert target.get_by_role('heading',name='Hủy đơn và nhận hàng quay về',exact=True).count()==0;other.close()
  report['checks'].append({'name':'buyer-admin-seller-route-denied','result':'PASS'})
  assert not errors,errors;report['result']='PASS'
 except Exception as e:
  report['result']='FAIL';report['error']=str(e);page.screenshot(path=str(out/'failure.png'),full_page=True);(out/'failure.txt').write_text(page.locator('body').inner_text(),encoding='utf-8');raise
 finally:
  report['sellerClosePosts']=len(writes);(out/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
print(json.dumps({'result':report['result'],'checks':len(report['checks'])}))
