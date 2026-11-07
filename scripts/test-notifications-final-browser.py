"""Native Chrome current-candidate notification checks; fixture secrets remain outside Git."""
import argparse,json,sys,time
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('--fixture',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
workspace=Path(__file__).resolve().parents[2];sys.path.insert(0,str(workspace/'machine-local/qa-tools/python'))
from playwright.sync_api import sync_playwright
fixture=json.loads(Path(args.fixture).read_text(encoding='utf-8'));out=Path(args.output);web=fixture['web'];api=fixture['api']
assert web=='http://127.0.0.1:5199' and api.startswith('http://127.0.0.1:')
report={'result':'RUNNING','checks':[]};errors=[];contexts=[];pages={};posts=[]

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
 def new_page(name, mobile=False):
  context=browser.new_context(viewport={'width':390,'height':844} if mobile else {'width':1440,'height':1000})
  context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(web+'/') or route.request.url.startswith(api+'/') else route.abort())
  target=context.new_page();target.set_default_timeout(25000);target.on('pageerror',lambda e:errors.append(str(e)));contexts.append(context);pages[name]=target
  target.on('request',lambda r:posts.append(r.url) if r.method=='POST' and '/account/notifications/' in r.url else None)
  return target
 def settled(target):target.get_by_text('Đang cập nhật…',exact=True).wait_for(state='hidden')
 def login(target,name):
  actor=fixture['actors'][name];target.goto(web+'/login');target.wait_for_load_state('networkidle');target.get_by_label('Email',exact=True).fill(actor['email']);target.get_by_label('Mật khẩu',exact=True).fill(actor['password']);target.get_by_role('button',name='Đăng nhập',exact=True).click();target.wait_for_url(lambda u:'/login' not in u)
  target.goto(web+'/account/notifications');target.get_by_role('heading',name='Thông báo',exact=True).wait_for();target.get_by_text('Đang cập nhật…',exact=True).wait_for(state='hidden');target.wait_for_load_state('networkidle')
 def logout(target):target.get_by_role('button',name='Đăng xuất',exact=True).click();target.wait_for_url(web+'/')
 def no_overflow(target):assert target.evaluate('document.documentElement.scrollWidth<=innerWidth')
 try:
  buyer=new_page('buyer');login(buyer,'BUYER');buyer.get_by_text('2 thông báo chưa đọc',exact=True).wait_for();buyer.get_by_label('Thông báo, 2 chưa đọc',exact=True).wait_for();assert buyer.locator('li').count()==2;assert len(posts)==0
  assert 'PRIVATE_' not in buyer.locator('body').inner_text()
  buyer.get_by_role('link',name='Xem chi tiết',exact=True).first.click();buyer.wait_for_url(web+f'/account/orders/{fixture["orderId"]}');buyer.get_by_role('heading',name='ORD-',exact=False).wait_for();assert len(posts)==0
  buyer.goto(web+'/account/notifications');buyer.get_by_text('2 thông báo chưa đọc',exact=True).wait_for();buyer.screenshot(path=str(out/'buyer-desktop.png'),full_page=True);no_overflow(buyer)
  report['checks'].append({'name':'actual-order-events-buyer-inbox-badge-guarded-destination-no-auto-read','result':'PASS'})

  # Hold a genuine old inbox response (including unread count2) across logout/login.
  held={};hold_enabled={'value':True}
  def hold_old(route):
   if hold_enabled['value'] and '/account/notifications?' in route.request.url:
    hold_enabled['value']=False;held['route']=route;held['response']=route.fetch();return
   route.continue_()
  buyer.route(api+'/account/notifications?*',hold_old)
  buyer.get_by_role('button',name='Tải lại',exact=True).click()
  deadline=time.monotonic()+10
  while 'response' not in held and time.monotonic()<deadline:buyer.wait_for_timeout(25)
  assert 'route' in held and held['response'].status==200
  logout(buyer);login(buyer,'OTHER_BUYER');buyer.get_by_text('0 thông báo chưa đọc',exact=True).wait_for();buyer.get_by_text('Không có thông báo trong bộ lọc này.',exact=True).wait_for()
  try:held['route'].fulfill(response=held['response']);report['oldResponseRelease']='FULFILLED_AFTER_SWITCH'
  except Exception:report['oldResponseRelease']='ABORTED_BY_NAVIGATION_OR_SESSION'
  buyer.unroute(api+'/account/notifications?*',hold_old);buyer.wait_for_timeout(100)
  assert buyer.locator('li').count()==0;assert 'Đơn hàng có cập nhật' not in buyer.locator('body').inner_text();assert buyer.get_by_label('Thông báo, 2 chưa đọc',exact=True).count()==0;assert len(posts)==0
  report['checks'].append({'name':'delayed-old-inbox-account-switch-clears-items-and-badge','result':'PASS'})
  logout(buyer);login(buyer,'BUYER');buyer.get_by_text('2 thông báo chưa đọc',exact=True).wait_for()

  before=len(posts);buyer.get_by_role('button',name='Đánh dấu đã đọc',exact=True).first.evaluate('(b)=>{b.click();b.click()}');buyer.get_by_text('Đã đánh dấu đã đọc.',exact=True).wait_for();settled(buyer);buyer.get_by_text('1 thông báo chưa đọc',exact=True).wait_for();assert len(posts)==before+1
  report['checks'].append({'name':'explicit-mark-one-single-flight-canonical-unread-count','result':'PASS'})
  endpoint=api+'/account/notifications/read-all';dropped=[]
  def lose_read_all(route):
   dropped.append(route.request.post_data_json);response=route.fetch();assert response.status==200;route.abort('failed')
  buyer.route(endpoint,lose_read_all);before=len(posts);buyer.get_by_role('button',name='Đánh dấu đến mốc đang hiển thị đã đọc',exact=True).click();buyer.get_by_role('alert').wait_for();assert len(dropped)==1 and len(posts)==before+1
  assert dropped[0]['confirmed'] is True and isinstance(dropped[0]['throughId'],str)
  buyer.unroute(endpoint,lose_read_all);buyer.reload();buyer.get_by_text('0 thông báo chưa đọc',exact=True).wait_for();assert len(posts)==before+1
  buyer.get_by_label('Lọc thông báo',exact=True).select_option('unread');buyer.get_by_text('Không có thông báo trong bộ lọc này.',exact=True).wait_for();assert len(posts)==before+1
  report['checks'].append({'name':'lost-read-all-after-upstream200-reload-GET-only-unread-filter','result':'PASS'})

  seller=new_page('seller',True);login(seller,'SELLER');seller.get_by_text('1 thông báo chưa đọc',exact=True).wait_for();assert seller.locator('li').count()==1;assert seller.get_by_role('link',name='Xem chi tiết',exact=True).get_attribute('href')==f'/seller/orders/{fixture["orderId"]}'
  seller.get_by_role('link',name='Xem chi tiết',exact=True).click();seller.wait_for_url(web+f'/seller/orders/{fixture["orderId"]}');seller.get_by_role('heading',name='ORD-',exact=False).wait_for();seller.goto(web+'/account/notifications');seller.get_by_text('1 thông báo chưa đọc',exact=True).wait_for();seller.screenshot(path=str(out/'seller-mobile.png'),full_page=True);no_overflow(seller)
  report['checks'].append({'name':'seller-receives-buyer-checkout-not-own-preparation-echo','result':'PASS'})
  admin=new_page('admin');login(admin,'ADMIN');admin.get_by_role('heading',name='Có hồ sơ Store chờ duyệt',exact=True).wait_for();admin.get_by_text('1 thông báo chưa đọc',exact=True).wait_for();assert admin.locator('li').count()==1;assert admin.get_by_role('link',name='Xem chi tiết',exact=True).get_attribute('href')==f'/admin/store-applications?storeId={fixture["pendingStoreId"]}';assert 'PRIVATE_' not in admin.locator('body').inner_text();assert 'Đơn hàng có cập nhật' not in admin.locator('body').inner_text();admin.screenshot(path=str(out/'admin-desktop.png'),full_page=True);no_overflow(admin)
  report['checks'].append({'name':'admin-current-pending-application-not-unrelated-order-or-private-reason','result':'PASS'})
  anonymous=new_page('anonymous');anonymous.goto(web+'/account/notifications');anonymous.wait_for_url(lambda u:'/login' in u);assert anonymous.get_by_role('heading',name='Thông báo',exact=True).count()==0
  report['checks'].append({'name':'anonymous-inbox-route-requires-login','result':'PASS'})
  assert not errors,errors;report['result']='PASS'
 except Exception as e:
  report['result']='FAIL';report['error']=str(e)
  for name,target in pages.items():
   try:target.screenshot(path=str(out/(name+'-failure.png')),full_page=True);(out/(name+'-failure.txt')).write_text(target.locator('body').inner_text(),encoding='utf-8')
   except Exception:pass
  raise
 finally:
  report['notificationPosts']=len(posts);(out/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
  for context in contexts:context.close()
  browser.close()
print(json.dumps({'result':report['result'],'groups':len(report['checks'])}))
