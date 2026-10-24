"""Question upload -> preview -> Korean preparation correction regression.
Requires Python Playwright/Chromium and production preview on localhost:4173.
Workers are deterministic doubles shared with browser-memory.py.
"""
import asyncio,json,os,runpy
from pathlib import Path
from playwright.async_api import async_playwright
FAKE=runpy.run_path(str(Path(__file__).with_name('browser-memory.py')))['FAKE']
async def main():
 async with async_playwright()as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);ctx=await b.new_context(reduced_motion='reduce')
  await ctx.add_init_script("Object.defineProperties(navigator,{platform:{get:()=> 'MacIntel'},maxTouchPoints:{get:()=>5},deviceMemory:{get:()=>undefined},hardwareConcurrency:{get:()=>8}});"+FAKE+"const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(data){if(data.prompts)qa.prompts=data.prompts;return post.call(this,data)};")
  page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(os.environ.get('APP_URL','http://127.0.0.1:4173/badawrite/'));await page.wait_for_function('!document.querySelector("main").inert')
  await page.locator('#script').fill('\n'.join(f'{i}. W: Hello.'for i in range(1,5)));await page.locator('.question-paper summary').click()
  paper='1. 가장 적절핫 것을 고르시오.\n① 선지입니다\n2. 가장 저절한 것을 고르시오.\n3. 여자의 옹답으로 가장\n적정한 것을 고르시오.\n4. Ms. Jones가 50달러를 지불하지 않은 이유는?'
  await page.locator('#paper-input').set_input_files({'name':'ocr.txt','mimeType':'text/plain','buffer':paper.encode()});await page.locator('#cancel').wait_for(state='hidden')
  cleaned=await page.locator('#question-paper').input_value();assert '적절핫'not in cleaned and '저절한'not in cleaned and '옹답'not in cleaned and '선지'not in cleaned;assert '50달러를 지불하지 않은' in cleaned
  await page.locator('#generate').click();await page.locator('#cancel').wait_for(state='hidden');prompts=await page.evaluate('qa.prompts')
  assert prompts==['1번. 가장 적절한 것을 고르시오.','2번. 가장 적절한 것을 고르시오.','3번. 여자의 응답으로 가장 적절한 것을 고르시오.','4번. Ms. Jones가 50달러를 지불하지 않은 이유는?'],prompts
  assert await page.locator('#download').is_enabled();assert not errors,errors
  print(json.dumps({'upload_text':cleaned,'spoken_prompts':prompts,'download_ready':True,'errors':errors},ensure_ascii=False,indent=2));await b.close()
if __name__=='__main__':asyncio.run(main())
