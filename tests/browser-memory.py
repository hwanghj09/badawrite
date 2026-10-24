"""Production UI regression checks; requires Python Playwright and Chromium.
Start: npm exec vite preview -- --host 127.0.0.1 --port 4173
Run: python tests/browser-memory.py
Workers are deterministic test doubles; this does not test actual iPadOS memory limits.
"""
import asyncio,json,os
from playwright.async_api import async_playwright
URL=os.environ.get('APP_URL','http://127.0.0.1:4173/badawrite/')
FAKE=r'''window.qa={mode:'success',events:[],posts:[]};
const NativeWorker=window.Worker;
window.Worker=class{
 constructor(url,opts){this.phase=String(url).includes('korean.worker')?'korean':String(url).includes('tts.worker')?'english':null;if(!this.phase)return new NativeWorker(url,opts);this.timers=[];qa.events.push(this.phase+':start');}
 terminate(){this.timers.forEach(clearTimeout);qa.events.push(this.phase+':terminate');}
 postMessage(input){const data=structuredClone(input);const send=d=>this.onmessage?.({data:d});const later=(ms,fn)=>this.timers.push(setTimeout(fn,ms));
  qa.posts.push({phase:this.phase,profile:data.profile,forceWasm:data.forceWasm,clips:data.koreanClips?.length,promptCount:data.prompts?.length});
  if(this.phase==='korean'){
   send({type:'status',message:'한국어 질문 준비 중'});
   later(300,()=>{if(qa.mode==='korean-error')send({type:'error',message:'한국어 모델을 준비하지 못했습니다.'});else send({type:'done',clips:data.prompts.map(text=>({text,samples:new Float32Array([0.5])}))});});return;
  }
  if(qa.mode==='gpu-error'&&!data.profile.lowMemory){later(30,()=>send({type:'error',retryWithWasm:true,message:'GPU unavailable'}));return;}
  if(data.profile.lowMemory&&data.questions.some(q=>q.questionPrompts?.length)&&!data.koreanClips?.length)throw Error('Prepared Korean PCM missing');
  const wav=()=>{const sr=24000,a=new ArrayBuffer(44+sr*2),v=new DataView(a);for(const[o,s]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));v.setUint32(4,a.byteLength-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,sr*2,true);return a;};
  data.questions.forEach((q,i)=>later(150+i*700,()=>{send({type:'progress',index:i});if(!data.skipPreviews.includes(i))send({type:'question',index:i,wav:wav()});}));
  later(400+data.questions.length*700,()=>send({type:'done',markers:data.questions.map((q,i)=>({id:q.id,start:i,end:i+1}))}));
 }
};'''
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  outcomes=[]
  for mobile in [True,False]:
   ctx=await browser.new_context(reduced_motion='reduce');await ctx.add_init_script(f"Object.defineProperties(navigator,{{platform:{{get:()=> 'MacIntel'}},maxTouchPoints:{{get:()=>{5 if mobile else 0}}},deviceMemory:{{get:()=>{4 if mobile else 8}}},hardwareConcurrency:{{get:()=>8}}}});"+FAKE)
   page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   async def reset(mode='success'):
    await page.goto(URL);await page.wait_for_function('!document.querySelector("main").inert');await page.evaluate('(mode)=>qa.mode=mode',mode)
    await page.locator('#script').fill('1. W: Hello.\n2. M: Goodbye.');await page.locator('.question-paper summary').click();await page.locator('#question-paper').fill('1. 다음을 듣고 답하시오.\n2. 다음을 듣고 고르시오.')
   async def generate():
    await page.locator('#generate').click();await page.locator('#cancel').wait_for(state='hidden');assert await page.locator('#download').is_enabled(),await page.locator('#status-message').inner_text()
   await reset();await generate();events=await page.evaluate('qa.events');posts=await page.evaluate('qa.posts')
   if mobile:
    assert events==['korean:start','korean:terminate','english:start','english:terminate'],events
    assert posts[1]['clips']==2 and posts[1]['profile']['lowMemory']
   else:assert events==['english:start'] and not posts[0]['profile']['lowMemory'],events
   outcomes.append({'test':'success','mobile':mobile,'events':events})
   if mobile:
    await reset();await page.locator('#generate').click();await page.wait_for_function('qa.events.includes("korean:start")');await page.locator('#cancel').click();await page.locator('#cancel').wait_for(state='hidden');await page.wait_for_timeout(400)
    assert await page.evaluate('qa.events')==['korean:start','korean:terminate'];assert await page.locator('#generate').is_enabled();await generate();outcomes.append({'test':'cancel_korean_and_retry','passed':True})
    await reset('korean-error');await page.locator('#generate').click();await page.locator('#cancel').wait_for(state='hidden');assert await page.locator('#generate').is_enabled();assert await page.evaluate('qa.events')==['korean:start','korean:terminate'];outcomes.append({'test':'korean_failure_no_english_model','passed':True})
    await reset();await page.locator('#generate').click();await page.wait_for_function('document.querySelector("#question-list button")&&!document.querySelector("#question-list button").disabled');await page.locator('#cancel').click();await page.locator('#cancel').wait_for(state='hidden');await generate();assert await page.locator('#ready-count').inner_text()=='2/2개 준비됨';outcomes.append({'test':'cancel_english_preserves_preview_and_retry','passed':True})
   else:
    await reset('gpu-error');await generate();events=await page.evaluate('qa.events');assert events==['english:start','english:terminate','korean:start','korean:terminate','english:start','english:terminate'],events
    await page.locator('#new-document').click();await page.locator('#script').fill('W: Another file.');await generate();posts=await page.evaluate('qa.posts');assert posts[-1]['profile']['lowMemory'];outcomes.append({'test':'gpu_failure_switches_session_to_safe_mode','events':events})
   assert not errors,errors;await ctx.close()
  print(json.dumps(outcomes,ensure_ascii=False,indent=2));await browser.close()
if __name__=='__main__':asyncio.run(main())
