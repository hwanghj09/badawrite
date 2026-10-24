"""Deterministic buffering UI tests. Run against production preview on port 4173.
Requires Python Playwright and Chromium. Audio workers are test doubles.
"""
import asyncio,json,os
from playwright.async_api import async_playwright
URL=os.environ.get('APP_URL','http://127.0.0.1:4173/badawrite/')
FAKE=r'''window.qa={events:[],worker:null};const NativeWorker=window.Worker;
window.Worker=class{
 constructor(url,opts){if(!String(url).includes('tts.worker'))return new NativeWorker(url,opts);qa.worker=this;qa.events.push('start');}
 terminate(){qa.events.push('terminate');}
 postMessage(data){this.data=data;this.onmessage({data:{type:'inference'}});}
};
qa.wav=seconds=>{const sr=24000,a=new ArrayBuffer(44+Math.round(seconds*sr)*2),v=new DataView(a);for(const[o,s]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));v.setUint32(4,a.byteLength-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,a.byteLength-44,true);v.setInt16(44,100,true);return a;};
qa.complete=(index,seconds,duration=30)=>{const w=qa.worker;w.onmessage({data:{type:'progress',index,seconds}});w.onmessage({data:{type:'question',index,wav:qa.wav(duration)}});};
qa.finish=()=>qa.worker.onmessage({data:{type:'done',markers:qa.worker.data.questions.map((q,i)=>({id:q.id,start:i*30,end:(i+1)*30}))}});'''
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);ctx=await b.new_context(reduced_motion='reduce');await ctx.add_init_script(FAKE);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));out=[]
  async def reset():
   await page.goto(URL);await page.wait_for_function('!document.querySelector("main").inert')
   await page.locator('#script').fill('\n'.join(f'{i}. W: '+('This is a listening practice sentence. '*17)for i in range(1,18)));await page.locator('#generate').click();await page.wait_for_function('qa.worker?.data')
  await reset();assert await page.evaluate('qa.worker.data.questionChime')is True
  await page.evaluate('qa.complete(0,120)');assert await page.locator('#audio').evaluate('(a)=>a.paused')
  await page.evaluate('qa.complete(1,120)');await page.wait_for_timeout(100);assert await page.locator('#audio').evaluate('(a)=>a.paused');assert '자동 시작까지 약' in await page.locator('#listening-buffer').inner_text()
  before=await page.locator('#listening-estimate').inner_text();await page.locator('#speed').select_option('1.25');assert before!=await page.locator('#listening-estimate').inner_text()
  await page.locator('#start-listening').click();await page.wait_for_function('!document.querySelector("#audio").paused');out.append({'test':'slow_device_waits_but_manual_start_works','passed':True})
  await reset();await page.evaluate('qa.complete(0,1)');assert await page.locator('#audio').evaluate('(a)=>a.paused');await page.evaluate('qa.complete(1,1)');await page.wait_for_function('!document.querySelector("#audio").paused');assert await page.locator('#cancel').is_visible();assert await page.locator('#question-list button:not([disabled])').count()==2;out.append({'test':'fast_device_starts_after_two_while_15_questions_pending','passed':True})
  await reset();await page.evaluate('qa.complete(0,120);qa.complete(1,120)');await page.locator('#auto-listening').click()
  for i in range(2,17):await page.evaluate('(i)=>qa.complete(i,120)',i)
  await page.evaluate('qa.finish()');await page.locator('#cancel').wait_for(state='hidden');assert await page.locator('#audio').evaluate('(a)=>a.paused');assert await page.locator('#download').is_enabled();out.append({'test':'cancel_auto_start_stays_cancelled_after_completion','passed':True})
  await reset();await page.evaluate('qa.complete(0,1)');await page.locator('#question-list button').first.click();await page.wait_for_function('!document.querySelector("#audio").paused');out.append({'test':'individual_question_overrides_initial_buffer','passed':True})
  await reset();await page.evaluate('qa.complete(0,120)');await page.locator('#cancel').click();await page.locator('#cancel').wait_for(state='hidden');await page.wait_for_timeout(1100);assert await page.locator('#audio').evaluate('(a)=>a.paused');assert await page.locator('#start-listening').is_enabled();out.append({'test':'generation_cancel_never_triggers_delayed_playback','passed':True})
  await page.set_viewport_size({'width':320,'height':850});assert await page.evaluate('document.documentElement.scrollWidth')==320;out.append({'test':'320px_buffer_controls_do_not_overflow','passed':True})
  assert not errors,errors;print(json.dumps(out,ensure_ascii=False,indent=2));await b.close()
if __name__=='__main__':asyncio.run(main())
