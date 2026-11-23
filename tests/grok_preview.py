# UI test of the Grok workflow (no API calls): restores a real run from JSON, uploads a stand-in
# "Grok output" image into concept 1 (file picker) and concept 2 (drag & drop), downloads the composite.
import os, sys, json, asyncio, base64
from playwright.async_api import async_playwright
RESTORE, IMG = sys.argv[1], sys.argv[2]
OUT = sys.argv[3] if len(sys.argv) > 3 else '/workspace/youtube-optimizer-preview'
BASE = 'http://localhost:8765/'
VID = '1KItA0PzRUw'

async def seed(page):
    st = json.load(open(RESTORE))
    item = {'id': VID, 'vid': VID, 'ts': 0, 'meta': st['meta'], 'brief': {'language': 'he'}, 'analysis': st['analysis'], 'seo': st['seo'], 'concepts': st['concepts'], 'models': st['models']}
    await page.goto(BASE)
    await page.evaluate("h => localStorage.setItem('ytps.history', JSON.stringify([h]))", item)
    await page.reload(); await page.wait_for_timeout(600)
    await page.click('#btnHistory'); await page.wait_for_timeout(300); await page.click('.hist-item')
    await page.wait_for_selector('#results:not(.hidden)'); await page.wait_for_timeout(1500)
    await page.click('.tab[data-t="th"]'); await page.wait_for_timeout(1200)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True, locale='he-IL')
        await ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE.rstrip('/'))
        page = await ctx.new_page()
        page.on('pageerror', lambda e: print('pageerror:', e))
        await seed(page)
        await page.screenshot(path=f'{OUT}/13-thumbs-before-grok.png', full_page=True)
        # copy prompt & open Grok
        async with ctx.expect_page() as newp:
            await page.click('[data-grokopen="0"]')
        np = await newp.value; print('opened:', np.url); await np.close()
        clip = await page.evaluate('navigator.clipboard.readText()'); print('clipboard starts:', clip[:70].replace('\n', ' '))
        # upload via file picker (concept 1)
        await page.set_input_files('[data-grok="0"]', IMG); await page.wait_for_timeout(1200)
        # drag & drop (concept 2)
        b64 = base64.b64encode(open(IMG, 'rb').read()).decode()
        await page.evaluate("""async (b64) => {
          const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const dt = new DataTransfer(); dt.items.add(new File([bin], 'grok.jpg', { type: 'image/jpeg' }));
          const el = document.querySelector('[data-drop="1"]');
          el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
          el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        }""", b64)
        await page.wait_for_timeout(1500)
        await page.click('.thumb-card[data-i="0"] .prompt-box summary'); await page.wait_for_timeout(400)
        await page.evaluate("document.querySelector('.grok-steps').scrollIntoView({behavior:'instant'})"); await page.wait_for_timeout(3600)
        await page.screenshot(path=f'{OUT}/14-thumbs-grok-desktop.png')
        await page.locator('.thumb-card[data-i="0"]').screenshot(path=f'{OUT}/15-grok-card-prompt-open.png')
        await page.evaluate("document.querySelector('#thumbGrid').scrollIntoView({behavior:'instant'})"); await page.wait_for_timeout(500)
        await page.screenshot(path=f'{OUT}/14b-thumbs-grok-grid.png')
        srcs = await page.evaluate("window.__ytps.thumbs.map(t => t.src)"); print('sources:', srcs)
        for i in (0, 1):
            async with page.expect_download() as d:
                await page.click(f'[data-dl="{i}"]')
            dl = await d.value; path = f'{OUT}/composite-grok-{i+1}.jpg'; await dl.save_as(path); print('saved', path, os.path.getsize(path))
        # mobile
        m = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = await m.new_page(); mp.on('pageerror', lambda e: print('m pageerror:', e))
        await seed(mp)
        await mp.set_input_files('[data-grok="0"]', IMG); await mp.wait_for_timeout(1200)
        await mp.evaluate("document.querySelector('.grok-steps').scrollIntoView({behavior:'instant'})"); await mp.wait_for_timeout(3600)
        await mp.screenshot(path=f'{OUT}/16-mobile-grok-steps.png')
        await mp.evaluate("document.querySelector('.thumb-card[data-i=\"0\"]').scrollIntoView({behavior:'instant'})"); await mp.wait_for_timeout(3600)
        await mp.screenshot(path=f'{OUT}/17-mobile-grok-card.png')
        await b.close()
asyncio.run(main())
