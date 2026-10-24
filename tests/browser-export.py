"""Download regression: speech worker deliberately omits all intro/chime audio.
Run production preview on localhost:4173; Python Playwright and Chromium required.
Static cue assets and WAV/ZIP downloads are real. No TTS model is used here.
"""
import asyncio,json,os,struct,wave,zipfile,tempfile
from pathlib import Path
from playwright.async_api import async_playwright
INIT=r'''const seen=new Set();new MutationObserver(()=>{for(const id of ['exam-audio','question-chime']){const e=document.getElementById(id);if(e&&!seen.has(id)){e.checked=false;seen.add(id)}}}).observe(document,{childList:true,subtree:true});
Object.defineProperties(navigator,{platform:{get:()=> 'MacIntel'},maxTouchPoints:{get:()=>5},deviceMemory:{get:()=>undefined},hardwareConcurrency:{get:()=>8}});
const NativeWorker=Worker;window.Worker=class{
 constructor(url,opts){if(!String(url).includes('tts.worker'))return new NativeWorker(url,opts);this.timers=[];}
 terminate(){this.timers.forEach(clearTimeout);}
 postMessage(data){const send=d=>this.onmessage?.({data:d});const later=(t,fn)=>this.timers.push(setTimeout(fn,t));let cursor=0;const markers=[];send({type:'inference'});
 data.questions.forEach((q,i)=>{const gap=q.endPause||(i<data.questions.length-1?data.questionGap:0),duration=.2+gap;markers.push({id:q.id,start:cursor,end:cursor+.2});cursor+=duration;
 later(100+i*100,()=>{const frames=Math.round(duration*24000),a=new ArrayBuffer(44+frames*2),v=new DataView(a);for(const[o,s]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let j=0;j<s.length;j++)v.setUint8(o+j,s.charCodeAt(j));v.setUint32(4,a.byteLength-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,24000,true);v.setUint32(28,48000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,frames*2,true);for(let j=0;j<4800;j++)v.setInt16(44+j*2,8191,true);send({type:'progress',index:i,seconds:.1});send({type:'question',index:i,wav:a});});});
 later(200+data.questions.length*100,()=>send({type:'done',markers}));
 }
};'''
def asset_pcm(path):
 with wave.open(str(path),'rb')as w:raw=w.readframes(w.getnframes())
 return [int(n*32767/32768)if n>=0 else n for n in struct.unpack('<'+'h'*(len(raw)//2),raw)]
async def main():
 root=Path(__file__).resolve().parents[1]
 async with async_playwright()as p:
  proxy={'server':os.environ['HTTPS_PROXY'],'bypass':'127.0.0.1,localhost'}if os.environ.get('HTTPS_PROXY')else None
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,proxy=proxy,args=['--no-sandbox']);ctx=await b.new_context(accept_downloads=True,reduced_motion='reduce');await ctx.add_init_script(INIT);page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(os.environ.get('APP_URL','http://127.0.0.1:4173/badawrite/'));await page.wait_for_function('!document.querySelector("main").inert')
  assert await page.locator('#exam-audio').is_checked();assert await page.locator('#question-chime').is_checked()
  await page.locator('#script').fill('1. W: Hello.\n2. M: Goodbye.');await page.locator('#new-document').click();await page.locator('#script').fill('W: Another file.');await page.locator('#generate').click();await page.locator('#cancel').wait_for(state='hidden',timeout=30000)
  intro=asset_pcm(root/'public/audio/csat-intro.wav');bell=asset_pcm(root/'public/audio/csat-chime.wav');records=[];wave_bytes=[]
  with tempfile.TemporaryDirectory()as tmp:
   for i in range(2):
    await page.locator('.document-select').nth(i).click();assert '시작 안내 포함' in await page.locator('#export-content').inner_text();assert '차임벨 포함' in await page.locator('#export-content').inner_text()
    async with page.expect_download()as e:await page.locator('#download').click()
    dl=await e.value;dest=Path(tmp)/f'{i}.wav';await dl.save_as(str(dest));wave_bytes.append(dest.read_bytes())
    with wave.open(str(dest),'rb')as w:
     assert w.getframerate()==24000 and w.getnchannels()==1;raw=w.readframes(w.getnframes());pcm=list(struct.unpack('<'+'h'*(len(raw)//2),raw));duration=w.getnframes()/24000
    assert pcm[:len(intro)]==intro
    positions=[len(intro)] + ([round(26.7*24000)]if i==0 else [])
    for pos in positions:assert pcm[pos:pos+len(bell)]==bell
    assert abs(duration-(29.1 if i==0 else 13.7))<.00001,duration
    records.append({'file':dl.suggested_filename,'seconds':duration,'intro_verified':True,'chime_count':len(positions)})
   async with page.expect_download()as e:await page.locator('#download-all').click()
   dl=await e.value;dest=Path(tmp)/'all.zip';await dl.save_as(str(dest))
   with zipfile.ZipFile(dest)as z:
    assert z.testzip()is None;assert len(z.namelist())==2
    for i,name in enumerate(z.namelist()):assert z.read(name)==wave_bytes[i]
  assert not errors,errors;print(json.dumps({'files':records,'zip_matches_individual_wavs':True,'restored_checkbox_defaults_verified':True,'errors':errors},ensure_ascii=False,indent=2));await b.close()
if __name__=='__main__':asyncio.run(main())
