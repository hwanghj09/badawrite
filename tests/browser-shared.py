"""Real-model integration check for the 16–17 broadcast and downloaded WAV/ZIP.
Requires a production preview, Python Playwright, Chromium and model CDN access.
Uses iPad-like device signals to exercise sequential Korean/English CPU workers.
APP_URL can target the deployed site. No speech worker is replaced.
"""
import asyncio, json, os, struct, tempfile, wave, zipfile
from pathlib import Path
from playwright.async_api import async_playwright

INIT = r'''Object.defineProperties(navigator,{platform:{get:()=> 'MacIntel'},maxTouchPoints:{get:()=>5},deviceMemory:{get:()=>undefined},hardwareConcurrency:{get:()=>8}});
window.qa={events:[],prompts:[],clips:[]};const NativeWorker=Worker;
window.Worker=class extends NativeWorker{
 constructor(url,opts){super(url,opts);this.phase=String(url).includes('korean.worker')?'korean':String(url).includes('tts.worker')?'english':null;
  if(this.phase)qa.events.push(this.phase+':start');
  if(this.phase==='korean')this.addEventListener('message',({data})=>{if(data.type==='done')qa.clips=data.clips.map(({text,samples})=>{const offset=Math.max(0,samples.findIndex(n=>Math.abs(n)>.005));return{text,length:samples.length,offset,pattern:Array.from(samples.slice(offset,offset+4096),n=>Math.trunc(Math.max(-1,Math.min(1,n))*(n<0?32768:32767)))}})});
 }
 postMessage(data,...rest){if(data.prompts)qa.prompts.push(...data.prompts);return super.postMessage(data,...rest)}
 terminate(){if(this.phase)qa.events.push(this.phase+':terminate');super.terminate()}
};'''

async def main():
    async with async_playwright() as p:
        proxy = {'server': os.environ['HTTPS_PROXY'], 'bypass': '127.0.0.1,localhost'} if os.environ.get('HTTPS_PROXY') else None
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, proxy=proxy, args=['--no-sandbox'])
        ctx = await browser.new_context(accept_downloads=True, reduced_motion='reduce')
        await ctx.add_init_script(INIT)
        page = await ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(os.environ.get('APP_URL', 'http://127.0.0.1:4173/badawrite/'))
        await page.wait_for_function('!document.querySelector("main").inert')
        await page.locator('#script').fill('[16~17] 다음을 듣고, 물음에 답하시오.\nW: Hello, students.')
        await page.locator('.question-paper summary').click()
        await page.locator('#question-paper').fill('16. 여자가 하는 말의 주제로 가장 적절한 것은?\n17. 언급되지 않은 것은?')
        await page.locator('#voice-settings summary').click()
        assert await page.locator('#shared-question-gap').input_value() == '10'
        await page.locator('#shared-question-gap').select_option('5')
        await page.locator('#repeat').check()
        await page.locator('#generate').click()
        assert await page.locator('#shared-question-gap').is_disabled()
        await page.locator('#cancel').wait_for(state='hidden', timeout=240000)
        assert await page.locator('#download').is_enabled(), await page.locator('#status-message').inner_text()
        qa = await page.evaluate('qa')
        assert qa['events'] == ['korean:start', 'korean:terminate', 'english:start', 'english:terminate'], qa['events']
        assert len(qa['prompts']) == 4, qa['prompts']
        assert qa['prompts'][0].startswith('십육번부터 십칠번까지는 두 번 들려줍니다.')
        assert qa['prompts'][1:] == ['다시 한 번 듣겠습니다.', '십육번. 여자가 하는 말의 주제로 가장 적절한 것은?', '십칠번. 언급되지 않은 것은?']
        with tempfile.TemporaryDirectory() as tmp:
            async with page.expect_download() as event:
                await page.locator('#download').click()
            path = Path(tmp) / 'shared.wav'
            await (await event.value).save_as(str(path))
            with wave.open(str(path), 'rb') as wav:
                assert wav.getframerate() == 24000 and wav.getnchannels() == 1
                raw = wav.readframes(wav.getnframes())
                frames = wav.getnframes()
            positions = []
            for clip in qa['clips']:
                pattern = struct.pack('<' + 'h' * len(clip['pattern']), *map(int, clip['pattern']))
                found = raw.find(pattern)
                assert found >= 0 and found % 2 == 0, clip['text']
                positions.append(found // 2 - clip['offset'])
            assert positions == sorted(positions)
            common, bridge, q16, q17 = positions
            english1 = common + qa['clips'][0]['length'] + round(.7 * 24000)
            english1_end = bridge - 3 * 24000
            english2 = bridge + qa['clips'][1]['length'] + round(.7 * 24000)
            assert english1_end > english1
            assert raw[english1*2:english1_end*2] == raw[english2*2:q16*2]
            assert q17 - q16 - qa['clips'][2]['length'] == 5 * 24000
            assert frames - q17 - qa['clips'][3]['length'] == 5 * 24000
            # The batch ZIP button appears once a second document is added;
            # an empty document is excluded from the archive.
            await page.locator('#new-document').click()
            async with page.expect_download() as event:
                await page.locator('#download-all').click()
            archive = Path(tmp) / 'shared.zip'
            await (await event.value).save_as(str(archive))
            with zipfile.ZipFile(archive) as z:
                assert len(z.namelist()) == 1 and z.read(z.namelist()[0]) == path.read_bytes()
        assert not errors, errors
        await page.locator('.document-select').first.click()
        await page.locator('#shared-question-gap').select_option('15')
        assert await page.locator('#download').is_disabled()
        assert await page.locator('#generate').is_enabled()
        print(json.dumps({'tts_prompts': qa['prompts'], 'worker_events': qa['events'], 'korean_positions_seconds': [n/24000 for n in positions], 'wav_seconds': frames/24000, 'english_repeated_exactly_twice': True, 'answer_pauses_seconds': [5, 5], 'zip_matches_wav': True, 'errors': errors}, ensure_ascii=False, indent=2))
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
