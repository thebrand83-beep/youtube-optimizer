# Headless UI preview: runs the real app end-to-end and captures screenshots + downloads.
# The key is read from env at runtime and injected into the ephemeral browser context only.
import os, sys, json, asyncio
from playwright.async_api import async_playwright
OUT = sys.argv[2] if len(sys.argv) > 2 else '/workspace/youtube-optimizer-preview'
URL = sys.argv[1] if len(sys.argv) > 1 else 'https://www.youtube.com/watch?v=1KItA0PzRUw'
BASE = 'http://localhost:8765/'
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, accept_downloads=True, locale='he-IL')
        page = await ctx.new_page()
        page.on('console', lambda m: print('console:', m.type, m.text[:200]) if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: print('pageerror:', e))
        # 1) empty state without key
        await page.goto(BASE); await page.wait_for_timeout(1500)
        await page.screenshot(path=f'{OUT}/01-home.png')
        await page.click('#btnSettings'); await page.wait_for_timeout(500)
        await page.screenshot(path=f'{OUT}/02-settings.png')
        # inject key into the ephemeral context (never written to disk in the repo)
        await page.evaluate("k => localStorage.setItem('ytps.geminiKey', k)", os.environ['GEMINI_API_KEY'])
        await page.reload(); await page.wait_for_timeout(1000)
        if os.environ.get('RESTORE'):
            # UI-only re-shoot from a previous real run (no API calls)
            st = json.load(open(os.environ['RESTORE']))
            vid = URL.split('v=')[-1][:11]
            item = {'id': vid, 'vid': vid, 'ts': 0, 'meta': st['meta'], 'brief': {'language': 'he'}, 'analysis': st['analysis'], 'seo': st['seo'], 'concepts': st['concepts'], 'models': st['models']}
            await page.evaluate("h => localStorage.setItem('ytps.history', JSON.stringify([h]))", item)
            await page.evaluate("() => sessionStorage.setItem('ytps.aiBlocked','1')")
            await page.reload(); await page.wait_for_timeout(800)
            await page.click('#btnHistory'); await page.wait_for_timeout(400); await page.click('.hist-item')
        else:
            await page.fill('#url', URL)
            await page.fill('#desc', os.environ.get('BRIEF', ''))
            await page.click('#go')
            await page.wait_for_timeout(6000)
            await page.screenshot(path=f'{OUT}/03-progress.png')
        await page.wait_for_selector('#results:not(.hidden), #errorSec:not(.hidden)', timeout=400000)
        if await page.is_visible('#errorSec'):
            await page.screenshot(path=f'{OUT}/99-error.png'); print('ERROR:', await page.inner_text('#errMsg')); return
        await page.wait_for_timeout(2200)
        await page.evaluate('window.scrollTo(0,0)')
        await page.screenshot(path=f'{OUT}/04-overview.png', full_page=True)
        for i, (t, name) in enumerate([('ti', '05-titles'), ('de', '06-description'), ('tg', '07-tags'), ('th', '08-thumbnails'), ('re', '09-report')]):
            await page.click(f'.tab[data-t="{t}"]'); await page.wait_for_timeout(1400)
            await page.evaluate('window.scrollTo(0,0)')
            await page.screenshot(path=f'{OUT}/{name}.png', full_page=True)
        # downloads
        await page.click('.tab[data-t="th"]'); await page.wait_for_timeout(800)
        for i in range(3):
            async with page.expect_download() as d:
                await page.click(f'[data-dl="{i}"]')
            dl = await d.value; path = f'{OUT}/thumbnail-{i+1}.jpg'; await dl.save_as(path); print('saved', path, os.path.getsize(path))
        # export state (no key inside) for text outputs
        st = await page.evaluate("() => { const S = window.__ytps; return { meta: S.meta, analysis: S.analysis, seo: S.seo, concepts: S.concepts, models: S.models, aiError: S.aiError, description: document.querySelector('#descText').value } }")
        if not os.environ.get('RESTORE'): json.dump(st, open(f'{OUT}/ui-run-output.json', 'w'), ensure_ascii=False, indent=2)
        # mobile
        m = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = await m.new_page(); await mp.goto(BASE); await mp.wait_for_timeout(1500)
        await mp.screenshot(path=f'{OUT}/10-mobile-home.png')
        await mp.evaluate("s => { localStorage.setItem('ytps.history', s) }", await page.evaluate("localStorage.getItem('ytps.history')"))
        await mp.reload(); await mp.wait_for_timeout(800)
        await mp.click('#btnHistory'); await mp.wait_for_timeout(500); await mp.click('.hist-item'); await mp.wait_for_timeout(2500)
        await mp.evaluate('window.scrollTo(0,0)'); await mp.screenshot(path=f'{OUT}/11-mobile-results.png', full_page=True)
        await mp.click('.tab[data-t="th"]'); await mp.wait_for_timeout(1500)
        await mp.evaluate("document.querySelector('#thumbGrid').scrollIntoView()"); await mp.wait_for_timeout(600)
        await mp.screenshot(path=f'{OUT}/12-mobile-thumbnails.png', full_page=False)
        await b.close()
asyncio.run(main())
