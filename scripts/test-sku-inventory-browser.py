"""Synthetic SKU editor acceptance using native Chrome; no providers."""
import argparse, json, sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--fixture', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
workspace = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(workspace / 'machine-local/qa-tools/python'))
from playwright.sync_api import sync_playwright

fixture = json.loads(Path(args.fixture).read_text(encoding='utf-8'))
out = Path(args.output)
web, api = fixture['web'], fixture['api']
assert web == 'http://127.0.0.1:5198' and api.startswith('http://127.0.0.1:')
report = {'result': 'RUNNING', 'checks': []}
errors, writes = [], []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe', headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.set_default_timeout(25000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: writes.append(request.url) if request.method == 'PATCH' and '/variants/' in request.url else None)
    try:
        actor = fixture['actors']['SELLER']
        page.goto(web + '/login'); page.wait_for_load_state('networkidle')
        page.get_by_label('Email', exact=True).fill(actor['email'])
        page.get_by_label('Mật khẩu', exact=True).fill(actor['password'])
        page.get_by_role('button', name='Đăng nhập', exact=True).click()
        page.wait_for_url(lambda url: '/login' not in url)
        for product in fixture['products']:
            page.set_viewport_size({'width': 390, 'height': 844} if product['name'] == 'normal' else {'width': 1440, 'height': 1000})
            page.goto(web + '/seller'); page.wait_for_load_state('networkidle')
            page.get_by_role('button', name='Sản phẩm (', exact=False).click()
            row = page.get_by_text('QA SKU ' + product['name'], exact=True).locator('..').locator('..')
            row.get_by_role('button', name='Chỉnh sửa', exact=True).click()
            editor = page.get_by_role('region', name='Điều chỉnh giá và tồn kho SKU', exact=True)
            editor.get_by_label('Giá mới của SKU (đồng)', exact=True).wait_for()
            editor.get_by_role('button', name='Kiểm tra thay đổi SKU', exact=True).wait_for(state='visible')
            price = editor.get_by_label('Giá mới của SKU (đồng)', exact=True)
            price.fill('12000')
            editor.get_by_label('Tồn kho mới của SKU', exact=True).fill('0' if product['name'] == 'normal' else '7')
            editor.get_by_label('Lý do điều chỉnh SKU', exact=True).fill('Synthetic browser stock review')
            editor.get_by_role('button', name='Kiểm tra thay đổi SKU', exact=True).click()
            save = editor.get_by_role('button', name='Lưu giá/kho SKU', exact=True)
            assert not save.is_enabled()
            editor.get_by_role('checkbox').check()
            endpoint = api + f'/seller/products/{product["id"]}/variants/{product["variantId"]}'
            before = len(writes)
            if product['name'] == 'stale':
                # A second client wins after this browser reviewed the old snapshot.
                def concurrent(route):
                    original = route.request.post_data_json
                    changed = dict(original, price='17000.00', stock=8, reason='Synthetic second client')
                    result = route.fetch(post_data=json.dumps(changed)); assert result.status == 200
                    result = route.fetch(); assert result.status == 409
                    route.fulfill(response=result)
                page.route(endpoint, concurrent)
                save.click(); editor.get_by_role('alert').wait_for()
                page.unroute(endpoint, concurrent)
                assert len(writes) == before + 1
                assert not editor.get_by_role('button', name='Kiểm tra thay đổi SKU', exact=True).is_enabled()
                editor.get_by_role('button', name='Tải lại giá/kho', exact=True).click()
                editor.get_by_role('status').get_by_text('Đã tải giá/kho hiện tại.', exact=False).wait_for()
                assert price.input_value() in ('17000', '17000.00')
                assert len(writes) == before + 1
            elif product['name'] == 'lost-response':
                def lose(route):
                    response = route.fetch(); assert response.status == 200
                    route.abort('failed')
                page.route(endpoint, lose)
                save.click(); editor.get_by_role('alert').wait_for()
                page.unroute(endpoint, lose)
                assert len(writes) == before + 1
                assert not editor.get_by_role('button', name='Kiểm tra thay đổi SKU', exact=True).is_enabled()
                editor.get_by_role('button', name='Tải lại giá/kho', exact=True).click()
                editor.get_by_role('status').get_by_text('Đã tải giá/kho hiện tại.', exact=False).wait_for()
                assert price.input_value() in ('12000', '12000.00')
                assert editor.get_by_label('Tồn kho mới của SKU', exact=True).input_value() == '7'
                assert len(writes) == before + 1
            else:
                with page.expect_response(lambda r: r.url == endpoint and r.request.method == 'PATCH') as response:
                    save.evaluate('(button)=>{button.click();button.click()}')
                assert response.value.status == 200
                editor.get_by_text('Đã lưu điều chỉnh giá/kho.', exact=False).wait_for()
                assert len(writes) == before + 1
                assert editor.get_by_label('Tồn kho mới của SKU', exact=True).input_value() == '0'
            assert page.locator('form form').count() == 0
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            editor.screenshot(path=str(out / (product['name'] + '.png')))
            report['checks'].append({'name': product['name'], 'result': 'PASS'})
        assert not errors, 'Unexpected browser pageerror'
        report['result'] = 'PASS'
    finally:
        report['pageErrors'] = errors
        (out / 'browser-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        browser.close()
