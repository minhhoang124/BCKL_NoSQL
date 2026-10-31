"""Native Chrome acceptance. Synthetic actors/QA only; no provider calls."""
import argparse,json,sys
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--fixture',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root/'machine-local/qa-tools/python'))
from playwright.sync_api import sync_playwright
fixture=json.loads(Path(args.fixture).read_text(encoding='utf-8'));out=Path(args.output);web=fixture['web'];api=fixture['api']
assert web=='http://127.0.0.1:5197' and api.startswith('http://127.0.0.1:')
report={'result':'RUNNING','checks':[]};errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
 context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page();page.set_default_timeout(25000);page.on('pageerror',lambda e:errors.append(str(e)))
 def login(target,actor):
  target.goto(web+'/login');target.wait_for_load_state('networkidle');target.get_by_label('Email',exact=True).fill(actor['email']);target.get_by_label('Mật khẩu',exact=True).fill(actor['password']);target.get_by_role('button',name='Đăng nhập',exact=True).click();target.wait_for_url(lambda u:'/login' not in u)
 def load_order(order):
  page.get_by_label('Mã đơn hàng',exact=True).fill(str(order['id']));page.get_by_role('button',name='Tải đơn',exact=True).click();page.get_by_role('heading',name='Đơn ORD-',exact=False).wait_for();page.get_by_label('Thao tác',exact=True).wait_for()
 def fill_command(command,order,attempt=1,disposition='RETURN_RECEIVED'):
  selector=page.get_by_label('Thao tác',exact=True)
  if selector.is_enabled():selector.select_option(command)
  if command!='confirm-returned':page.get_by_label('Mã vận đơn',exact=True).fill(order['tracking'])
  if command in ('mark-delivered','delivery-failed'):page.get_by_label('Lần giao',exact=True).fill(str(attempt))
  if command in ('delivery-failed','confirm-returned'):page.get_by_label('Chi tiết lý do',exact=True).fill('QA reason '+order['name'])
  if command=='confirm-returned':
   page.get_by_label('Tình trạng hàng hoàn',exact=True).select_option(disposition)
   if disposition!='LOST':page.get_by_label('Biên nhận hàng hoàn',exact=True).fill('QA-RECEIPT-'+str(order['id']))
  page.get_by_role('checkbox',name='Tôi đã kiểm tra đúng đơn',exact=False).check()
 def command(command,order,attempt=1,disposition='RETURN_RECEIVED'):
  fill_command(command,order,attempt,disposition)
  with page.expect_response(lambda r:r.url==api+f'/admin/orders/{order["id"]}/{command}' and r.request.method=='POST') as res:
   page.get_by_role('button',name='Xác nhận mô phỏng',exact=True).evaluate('(b)=>{b.click();b.click()}')
  assert res.value.status==200
  page.get_by_text('Đã xác minh biên nhận.',exact=False).wait_for()
  assert page.evaluate('sessionStorage.getItem("bckl:admin-fulfilment:v1:'+str(fixture['actors']['ADMIN']['id'])+'")') is None
  page.get_by_role('button',name='Tải đơn',exact=True).click();page.get_by_role('heading',name='Đơn ORD-',exact=False).wait_for()
  return res.value.json()
 try:
  login(page,fixture['actors']['ADMIN']);page.goto(web+'/admin/fulfilment');page.wait_for_load_state('networkidle');page.get_by_role('heading',name='Giao hàng mô phỏng',exact=True).wait_for()
  for order in (o for o in fixture['orders'] if o['name']!='return-race'):
   if order['name']=='buyer-cancel':
    other=browser.new_context();buyer=other.new_page();buyer.set_default_timeout(25000);login(buyer,fixture['actors']['USER']);buyer.goto(web+f'/account/orders/{order["id"]}');buyer.get_by_role('button',name='Hủy đơn',exact=True).click();buyer.get_by_label('Mô tả lý do hủy',exact=True).fill('QA early cancellation');buyer.get_by_role('checkbox').check();buyer.get_by_role('button',name='Xác nhận hủy đơn',exact=True).evaluate('(b)=>{b.click();b.click()}');buyer.get_by_text('Đã xác minh biên nhận và tải lại đơn.',exact=False).wait_for();buyer.screenshot(path=str(out/'buyer-cancel.png'),full_page=True)
    buyer.goto(web+'/admin/fulfilment');buyer.wait_for_url(web+'/');assert buyer.get_by_role('heading',name='Giao hàng mô phỏng',exact=True).count()==0;other.close();report['checks'].append({'name':'buyer-cancel-and-admin-ui-denied','result':'PASS','orderId':order['id']});continue
   page.emulate_media(color_scheme='dark' if order['name']=='restock' else 'light')
   page.set_viewport_size({'width':390,'height':844} if order['name']=='restock' else {'width':1440,'height':1000})
   load_order(order);command('ship',order)
   if order['name']=='success':command('mark-delivered',order)
   elif order['name']=='retry':
    command('delivery-failed',order);command('retry-delivery',order)
    stale=context.request.post(api+f'/admin/orders/{order["id"]}/mark-delivered',headers={'Authorization':'Bearer '+fixture['actors']['ADMIN']['token'],'Idempotency-Key':'stale_attempt_probe_'+str(order['id'])},data={'trackingReference':order['tracking'],'deliveryAttempt':1})
    assert stale.status==409;assert stale.json()['code']=='STALE_DELIVERY_ATTEMPT'
    command('mark-delivered',order,2)
   elif order['name']=='attempt-limit':
    for attempt in range(1,5):
     command('delivery-failed',order,attempt)
     if attempt<4:command('retry-delivery',order)
    assert page.get_by_label('Thao tác',exact=True).locator('option[value="retry-delivery"]').count()==0
   else:
    command('delivery-failed',order)
    if order['name']=='restock':
     endpoint=api+f'/admin/orders/{order["id"]}/confirm-returned';keys=[]
     def lose(route):
      keys.append(route.request.headers['idempotency-key']);res=route.fetch();assert res.status==200;route.abort('failed')
     page.route(endpoint,lose);fill_command('confirm-returned',order);page.get_by_role('button',name='Xác nhận mô phỏng',exact=True).click();page.get_by_role('alert').wait_for();page.unroute(endpoint,lose)
     saved=json.loads(page.evaluate('sessionStorage.getItem("bckl:admin-fulfilment:v1:'+str(fixture['actors']['ADMIN']['id'])+'")'));assert set(saved)=={'actorId','orderId','command','key','hash'};assert len(keys)==1
     page.reload();page.wait_for_load_state('networkidle');page.get_by_label('Thao tác',exact=True).wait_for();fill_command('confirm-returned',order)
     # Different body must not be sent using the pending key.
     page.get_by_label('Chi tiết lý do',exact=True).fill('changed body');page.get_by_role('checkbox',name='Tôi đã kiểm tra đúng đơn',exact=False).check();page.get_by_role('button',name='Gửi lại cùng yêu cầu',exact=True).click();page.get_by_text('Nội dung khác yêu cầu đang chờ.',exact=False).wait_for()
     page.get_by_label('Chi tiết lý do',exact=True).fill('QA reason '+order['name']);page.get_by_role('checkbox',name='Tôi đã kiểm tra đúng đơn',exact=False).check()
     with page.expect_response(lambda r:r.url==endpoint and r.request.method=='POST') as res:page.get_by_role('button',name='Gửi lại cùng yêu cầu',exact=True).click()
     assert res.value.status==200 and res.value.json()['replayed'] is True;assert res.value.request.headers['idempotency-key']==keys[0];page.get_by_text('Đã xác minh biên nhận.',exact=False).wait_for();page.get_by_role('button',name='Tải đơn',exact=True).click();page.get_by_role('heading',name='Đơn ORD-',exact=False).wait_for()
    else:command('confirm-returned',order,disposition='DAMAGED' if order['name']=='damaged' else 'LOST')
   page.screenshot(path=str(out/(order['name']+'.png')),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   if order['name'] in ('success','retry'):
    other=browser.new_context();buyer=other.new_page();buyer.set_default_timeout(25000);login(buyer,fixture['actors']['USER']);buyer.goto(web+f'/account/orders/{order["id"]}');buyer.get_by_role('button',name='Xác nhận đã nhận hàng',exact=True).click();buyer.get_by_role('checkbox').check();buyer.get_by_role('button',name='Xác nhận hoàn tất đơn',exact=True).click();buyer.get_by_text('Đã xác minh biên nhận và tải lại đơn.',exact=False).wait_for();other.close()
   report['checks'].append({'name':order['name'],'result':'PASS','orderId':order['id']})
  other=browser.new_context();seller=other.new_page();seller.set_default_timeout(25000);login(seller,fixture['actors']['SELLER']);seller.goto(web+'/admin/fulfilment');seller.wait_for_url(web+'/');assert seller.get_by_role('heading',name='Giao hàng mô phỏng',exact=True).count()==0;other.close()
  report['sellerAdminRouteDenied']=True
  assert not errors,errors;report['result']='PASS'
 except Exception as e:
  report['result']='FAIL';report['error']=str(e);page.screenshot(path=str(out/'failure.png'),full_page=True);(out/'failure.txt').write_text(page.locator('body').inner_text(),encoding='utf-8');raise
 finally:
  (out/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
print(json.dumps({'result':report['result'],'checks':len(report['checks'])}))
