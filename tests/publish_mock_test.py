"""Mocked end-to-end test of the 'Publish to YouTube' flow (GIS + YouTube Data API + Gemini captions are stubbed).
Run: python3 -m http.server 8765 &  then  python3 tests/publish_mock_test.py [restore.json]"""
import json, re, sys, asyncio, copy
from playwright.async_api import async_playwright
OUT = '/workspace/youtube-optimizer-preview'
VID = '1KItA0PzRUw'
st = json.load(open(sys.argv[1] if len(sys.argv) > 1 else '/tmp/restore.json'))
st['seo']['category_id'] = '26'
hist = [{'id': VID, 'vid': VID, 'ts': 1763900000000, 'meta': st['meta'], 'brief': {'language': 'he'}, 'analysis': st['analysis'], 'seo': st['seo'], 'concepts': st['concepts'], 'models': st['models']}]
srt = open(f'{OUT}/captions/captions.he.srt').read()
def srt_cues(t):
    out = []
    for b in t.strip().split('\n\n'):
        l = b.split('\n'); a, z = l[1].split(' --> ')
        sec = lambda x: (lambda h, m, s: int(h) * 3600 + int(m) * 60 + float(s.replace(',', '.')))(*x.split(':'))
        out.append({'start': sec(a), 'end': sec(z), 'text': ' '.join(l[2:])})
    return out
CUES = srt_cues(srt)
GIS = """window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>setTimeout(()=>c.callback({access_token:'tok-mock',expires_in:3600,scope:'https://www.googleapis.com/auth/youtube.force-ssl'}),80)}),hasGrantedAllScopes:()=>true,revoke:(t,cb)=>cb&&cb()}}};"""
ORIG = {'title': 'הסרטון המקורי שלי', 'description': 'תיאור ישן וקצר', 'tags': ['צילום'], 'categoryId': '22', 'channelId': 'UCme', 'channelTitle': 'Studio Image',
        'thumbnails': {'high': {'url': f'https://i.ytimg.com/vi/{VID}/hqdefault.jpg'}}}

def make_api(state, fail=None):
    fail = fail or {}
    calls = state['calls']
    async def handle(route):
        r = route.request; url = r.url; m = r.method
        H = {'access-control-allow-origin': '*', 'content-type': 'application/json'}
        auth = r.headers.get('authorization', '')
        calls.append((m, re.sub(r'https://www.googleapis.com', '', url.split('?')[0]), url))
        def ok(o, s=200): return route.fulfill(status=s, headers=H, body=json.dumps(o, ensure_ascii=False))
        def err(s, reason): return route.fulfill(status=s, headers=H, body=json.dumps({'error': {'code': s, 'message': reason, 'errors': [{'reason': reason}]}}))
        if m == 'OPTIONS': return await route.fulfill(status=204, headers={**H, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
        if auth != 'Bearer tok-mock': return await err(401, 'authError')
        if '/youtube/v3/channels' in url:
            return await ok({'items': [{'id': state['channel'], 'snippet': {'title': 'Studio Image', 'thumbnails': {'default': {'url': 'https://yt3.ggpht.com/a/default-user=s88'}}}}]})
        if '/youtube/v3/videos' in url and m == 'GET':
            return await ok({'items': [{'id': VID, 'snippet': copy.deepcopy(state['snippet']), 'status': {'privacyStatus': 'public'}}]})
        if '/youtube/v3/videos' in url and m == 'PUT':
            body = json.loads(r.post_data); state['puts'].append(body)
            if 'videos' in fail: return await err(*fail['videos'])
            state['snippet'].update(body['snippet']); return await ok({'id': VID, 'snippet': state['snippet']})
        if '/thumbnails/set' in url:
            state['thumbs'].append((r.headers.get('content-type'), len(r.post_data_buffer or b'')))
            if 'thumb' in fail: return await err(*fail['thumb'])
            return await ok({'items': [{'default': {'url': 'x'}}]})
        if '/upload/youtube/v3/captions' in url:
            state['caps'].append(r.post_data_buffer.decode('utf8'))
            if 'caption' in fail: return await err(*fail['caption'])
            return await ok({'id': f'cap{len(state["caps"])}', 'snippet': {'language': 'he'}})
        if '/youtube/v3/commentThreads' in url:
            state['comments'].append(json.loads(r.post_data))
            if 'comment' in fail: return await err(*fail['comment'])
            return await ok({'id': 'thr1', 'snippet': {'topLevelComment': {'id': 'cmt1'}}})
        if m == 'DELETE': state['deletes'].append(url.split('?')[1]); return await route.fulfill(status=204, headers=H, body='')
        return await err(400, 'unexpected')
    return handle

async def gemini(route):
    body = route.request.post_data or ''
    obj = {'cues': CUES} if 'professionally timed subtitles' in body else {}
    await asyncio.sleep(1.2)
    await route.fulfill(status=200, headers={'content-type': 'text/event-stream', 'access-control-allow-origin': '*'},
                        body='data: ' + json.dumps({'candidates': [{'content': {'parts': [{'text': json.dumps(obj, ensure_ascii=False)}]}, 'finishReason': 'STOP'}]}) + '\n\n')

async def setup(b, state, fail=None, client_id=True, w=1440):
    ctx = await b.new_context(viewport={'width': w, 'height': 900}, accept_downloads=True)
    await ctx.add_init_script(GIS)
    page = await ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    await page.route('**/accounts.google.com/gsi/client', lambda r: r.fulfill(status=200, body='', headers={'content-type': 'text/javascript'}))
    await page.route('**/www.googleapis.com/**', make_api(state, fail))
    await page.route('**/generativelanguage.googleapis.com/**', gemini)
    await page.goto('http://localhost:8765/')
    s = {'quality': 'balanced', 'aiImages': 'off', 'links': ''}
    if client_id: s['clientId'] = '1234567890-mocktest.apps.googleusercontent.com'
    await page.evaluate("([h,s])=>{localStorage.clear();localStorage.setItem('ytps.geminiKey','mock');localStorage.setItem('ytps.history',h);localStorage.setItem('ytps.settings',s)}", [json.dumps(hist, ensure_ascii=False), json.dumps(s)])
    await page.reload(); await page.click('#btnHistory'); await page.click('.hist-item')
    await page.wait_for_selector('#results:not(.hidden)')
    await page.click('.tab[data-t="pub"]'); await page.wait_for_timeout(500)
    return ctx, page, errs

def new_state(owner='UCme'):
    return {'channel': owner, 'snippet': copy.deepcopy(ORIG), 'calls': [], 'puts': [], 'thumbs': [], 'caps': [], 'comments': [], 'deletes': []}

async def shot(page, name, sel=None):
    if sel: await page.locator(sel).first.scroll_into_view_if_needed()
    await page.screenshot(path=f'{OUT}/{name}', full_page=False)

def check(cond, msg):
    print(('  PASS ' if cond else '  FAIL ') + msg)
    if not cond: check.fails += 1
check.fails = 0

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        print('A) no Client ID → Hebrew notice + help modal')
        st0 = new_state(); ctx, page, errs = await setup(b, st0, client_id=False)
        await page.evaluate("window.scrollTo({top:0,behavior:'instant'})"); await shot(page, '20-publish-no-client-id.png')
        check(await page.locator('text=עוד צעד אחד: חיבור לחשבון Google').count() == 1, 'missing Client ID notice shown')
        check(await page.locator('[data-pub="publish"][disabled]').count() == 1, 'publish disabled before connecting')
        await page.click('.pub-note [data-pub="help"]'); await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT}/21-setup-guide-modal.png')
        check(await page.locator('#ytHelp.open .guide li').count() == 5, 'help modal has 5 steps')
        await page.keyboard.press('Escape')
        await page.click('.pub-note [data-pub="settings"]'); await page.wait_for_timeout(300)
        await page.fill('#clientId', 'not-a-client-id'); await page.click('#saveSettings')
        check('Client ID' in await page.inner_text('#cidStatus'), 'invalid Client ID rejected in Hebrew')
        await page.fill('#clientId', '1234567890-mocktest.apps.googleusercontent.com'); await page.click('#saveSettings'); await page.wait_for_timeout(300)
        check(await page.locator('[data-pub="connect"]').count() == 1, 'after saving Client ID → connect button')
        check(not errs, f'no page errors {errs}'); await ctx.close()

        print('B) connect → ownership → diff preview → publish all → restore')
        s = new_state(); ctx, page, errs = await setup(b, s)
        await page.click('[data-pub="connect"]'); await page.wait_for_selector('.pub-conn')
        check('הסרטון שייך לערוץ הזה' in await page.inner_text('.pub-conn'), 'ownership verified')
        check(await page.locator('.d-before >> text=הסרטון המקורי שלי').count() == 1, 'diff shows current title (before)')
        await page.locator('.pub-group').first.scroll_into_view_if_needed(); await page.evaluate("window.scrollBy({top:-140,behavior:'instant'})"); await page.wait_for_timeout(300); await shot(page, '22-publish-connected-diff.png')
        await page.locator('.pub-group').nth(1).scroll_into_view_if_needed(); await page.evaluate("window.scrollBy({top:-130,behavior:'instant'})"); await page.wait_for_timeout(200); await shot(page, '23-publish-thumb-captions.png')
        await page.click('[data-tp="1"]')
        await page.check('[data-chk="capEn"]', force=True)
        q = await page.inner_text('.quota b'); check(q.replace(',', '') == str(50 + 50 + 400 + 400 + 50 + 3), f'quota total updates live ({q})')
        await page.uncheck('[data-chk="capEn"]', force=True)
        await page.fill('#pubComment', 'מה הטכניקה האהובה עליכם? ספרו בתגובות 👇')
        await page.click('[data-pub="publish"]')
        await page.wait_for_selector('#pubProg:not(.hidden)'); await page.wait_for_timeout(700)
        await shot(page, '24-publish-progress.png', '.pub-go')
        await page.wait_for_selector('.pub-results h4:has-text("הכל עודכן")', timeout=30000)
        await shot(page, '25-publish-results.png', '.pub-results')
        put = s['puts'][0]['snippet']
        check(put['title'] == st['seo']['titles'][0]['title'], 'videos.update: new title')
        check(put['description'].startswith(st['seo']['descriptionText'][:40]) and '0:00' in put['description'], 'videos.update: description with chapters')
        check(put['tags'] == st['seo']['tags'] and len(','.join(put['tags'])) <= 500, 'videos.update: tags ≤500')
        check(put['categoryId'] == '26' and put['defaultLanguage'] == 'he', 'videos.update: category + default language')
        check(s['thumbs'] and s['thumbs'][0][0] == 'image/jpeg' and 0 < s['thumbs'][0][1] < 2 * 1024 * 1024, f'thumbnails.set JPEG < 2MB ({s["thumbs"][0][1] // 1024}KB)')
        cap = s['caps'][0] if s['caps'] else ''
        check('"language":"he"' in cap and '00:00:00,000 -->' in cap and 'multipart' not in cap[:5], 'captions.insert multipart with he SRT')
        check(s['comments'] and s['comments'][0]['snippet']['topLevelComment']['snippet']['textOriginal'].startswith('מה הטכניקה'), 'commentThreads.insert with edited text')
        check(await page.locator(f'.pub-results a[href*="lc=cmt1"]').count() == 1, 'direct link to comment for manual pin')
        bk = await page.evaluate(f"JSON.parse(localStorage.getItem('ytps.backup.{VID}'))")
        check(bk and bk['snippet']['title'] == 'הסרטון המקורי שלי' and bk['created']['captions'] == ['cap1'] and bk['created']['comments'] == ['cmt1'], 'backup has original snippet + created ids')
        check(bool(bk.get('thumbDataUrl', '').startswith('data:image')), 'backup has original thumbnail data URL')
        async with page.expect_download() as dl: await page.click('[data-pub="backup"]')
        d = await dl.value; path = f'{OUT}/backup-sample.json'; await d.save_as(path)
        check(json.load(open(path))['videoId'] == VID, f'backup JSON downloads ({d.suggested_filename})')
        n_put = len(s['puts'])
        await page.click('[data-pub="restore"]')
        await page.wait_for_selector('.pub-results h4:has-text("שוחזר למקור")', timeout=20000)
        await shot(page, '26-restore-results.png', '.pub-results')
        rs = s['puts'][n_put]['snippet']
        check(rs['title'] == 'הסרטון המקורי שלי' and rs['tags'] == ['צילום'] and rs['categoryId'] == '22' and rs['description'] == 'תיאור ישן וקצר', 'restore: original snippet re-applied')
        check(len(s['thumbs']) == 2, 'restore: original thumbnail re-uploaded')
        check('id=cap1' in s['deletes'] and 'id=cmt1' in s['deletes'], 'restore: inserted caption + comment deleted')
        check(await page.evaluate(f"localStorage.getItem('ytps.backup.{VID}')") is None, 'backup cleared after full restore')
        check(not errs, f'no page errors {errs}'); await ctx.close()

        print('C) errors: unverified channel thumbnail + comments disabled + quota')
        s = new_state(); ctx, page, errs = await setup(b, s, fail={'thumb': (403, 'forbidden'), 'comment': (403, 'commentsDisabled'), 'caption': (403, 'quotaExceeded')})
        await page.click('[data-pub="connect"]'); await page.wait_for_selector('.pub-conn')
        await page.click('[data-pub="publish"]')
        await page.wait_for_selector('.pub-results h4:has-text("נכשלו")', timeout=30000)
        txt = await page.inner_text('.pub-results')
        check('מאומת' in txt, 'thumbnail 403 → Hebrew "channel must be verified"')
        check('התגובות בסרטון הזה כבויות' in txt, 'comments disabled → Hebrew message')
        check('המכסה היומית' in txt, 'quotaExceeded → Hebrew quota message')
        check(s['puts'], 'other items still applied (independent steps)')
        await shot(page, '27-publish-errors.png', '.pub-results')
        check(not errs, f'no page errors {errs}'); await ctx.close()

        print('D) video belongs to another channel → blocked')
        s = new_state(owner='UCsomeoneElse'); ctx, page, errs = await setup(b, s)
        await page.click('[data-pub="connect"]'); await page.wait_for_selector('.pub-conn')
        check('✗' in await page.inner_text('.pub-conn .chip'), 'ownership mismatch shown')
        check(await page.locator('[data-pub="publish"][disabled]').count() == 1, 'publish disabled for foreign video')
        check(not s['puts'], 'no writes')
        await page.evaluate("window.scrollTo({top:0,behavior:'instant'})"); await shot(page, '28-not-owner.png')
        await ctx.close()

        print('E) mobile layout')
        s = new_state(); ctx, page, errs = await setup(b, s, w=390)
        await page.click('[data-pub="connect"]'); await page.wait_for_selector('.pub-conn')
        await page.locator('.pub-group').first.scroll_into_view_if_needed(); await shot(page, '29-publish-mobile.png')
        check(not errs, f'no page errors {errs}'); await ctx.close()
        await b.close()
    print('FAILS:', check.fails)
asyncio.run(main())
