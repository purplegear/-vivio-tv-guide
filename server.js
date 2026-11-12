/** VIVIO TV Guide v5 — real XMLTV; allowlisted sources only; no sample schedule. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const base = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(base,'docs');
const cacheDir = path.join(base,'.epg-cache');
const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TTL = 6 * 60 * 60 * 1000;
const MAX_COMPRESSED = 48 * 1024 * 1024;
const MAX_XML_BYTES = 290 * 1024 * 1024;
const ZONE = Object.freeze({FR:'Europe/Paris',BG:'Europe/Sofia',GB:'Europe/London'});
// Current public source URLs, not broadcaster APIs. Each source may change availability or terms.
export const FEEDS = Object.freeze({
 FR: [
  {name:'XMLTV France',url:'https://xmltvfr.fr/xmltv/xmltv_fr.xml.gz'},
  {name:'M3U Edit FR1',url:'https://m3u-edit.com/epg-source.php?file=FR1.xml.gz'},
  {name:'epg.pw France',url:'https://epg.pw/xmltv/epg_FR.xml.gz'},
 ],
 BG: [
  {name:'MEGA EPG BG (3 days)',url:'https://github.com/harrygg/EPG/releases/latest/download/bulgarian.3days.full.epg.xml.gz'},
  {name:'iptv-org Vivacom BG',url:'https://iptv-org.github.io/epg/guides/bg/vivacom.bg.epg.xml'},
  {name:'M3U Edit BG1',url:'https://m3u-edit.com/epg-source.php?file=BG1.xml.gz'},
  {name:'epg.pw Bulgaria',url:'https://epg.pw/xmltv/epg_BG.xml.gz'},
  {name:'EPGShare Bulgaria',url:'https://epgshare01.online/epgshare01/epg_ripper_BG1.xml.gz'},
 ],
 GB: [
  {name:'EPGTalk UK',url:'https://raw.githubusercontent.com/acidjesuz/EPGTalk/master/UK_guide.xml.gz'},
  {name:'M3U Edit UK1',url:'https://m3u-edit.com/epg-source.php?file=UK1.xml.gz'},
  {name:'Freeview EPG',url:'https://raw.githubusercontent.com/dp247/Freeview-EPG/master/epg.xml'},
  {name:'epg.pw UK',url:'https://epg.pw/xmltv/epg_GB.xml.gz'},
 ],
});
const cache = new Map();
const inflight = new Map();

function unescapeXML(value='') {
 const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
 return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
 .replace(/&#(x[\da-f]+|\d+);|&([a-z]+);/gi, (_,n,k)=>{
  if(n){try{return String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):+n)}catch{return ''}}
  return named[k]??`&${k};`;
 }).replace(/<[^>]*>/g,'').trim();
}
const attr=(tag,name)=>{
 const match=tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,'i'));
 return match?unescapeXML(match[2]):'';
};
const field=(s,name)=>{
 const m=s.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));
 return m?unescapeXML(m[1]):'';
};
function xmlTime(value) {
 const m=String(value).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-])(\d{2})(\d{2}))?/);
 if(!m)return null;
 const t=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0));
 const offset=m[7]?((m[7]==='+'?1:-1)*(+m[8]*60 + +m[9])*60000):0;
 return t-offset;
}
export function classify(name){
 const s=String(name).toLocaleLowerCase();
 const patterns=[
  ['sport',/sport|спорт|eurosport|bein|sky sports|tnt sports|football|golf|racing|diema sport|max sport|setanta|rugby|premier league/],
  ['news',/news|новини|bfm|cnews|lci|euronews|franceinfo|cnn|bbc news|bloomberg|cnbc|24h|al jazeera|новини/],
  ['kids',/kids|детск|disney|nick|cartoon|gulli|cbeebies|cbbc|pop kids|tiji|baby|boomerang|minimax/],
  ['movies',/cin[eé]|кино|movie|film|tcm|hollywood|cinema|box office|grand.ecran/],
  ['series',/s[eé]rie|series|сериал|axn|syfy|warner tv|novela|drama/],
  ['music',/music|музик|mtv|vh1|mezzo|trace|mcm|balkanika/],
  ['docs',/document|документ|discovery|national geographic|nat geo|history|animal planet|viasat|science|nature/],
  ['travel',/voyage|travel|journey|пътешеств/],
  ['business',/business|бизнес|bloomberg|cnbc/],
  ['shopping',/shop|qvc|shopping|телешоп/],
  ['religion',/faith|religio|kto|tbn|ewtn/],
  ['education',/education|училищ|learn|knowledge/],
  ['regional',/regional|region|местн|france 3|itv wales|bbc wales|bbc scotland/],
  ['international',/international|world|global/],
  ['entertainment',/comedy|reality|entertainment|lifestyle|tlc/],
 ];
 const ids=patterns.filter(([,rx])=>rx.test(s)).map(([category])=>category);
 if(ids.length)return ids;
 return /^(tf1|france [2345]|m6|arte|bnt|бнт|btv|b.tv|nova|bbc (one|two)|itv1|channel [45])/i.test(name)?['general']:['other'];
}

/** Fast streaming SAX-like extraction, supports .xml, .xml.gz with or without Content-Encoding. */
export async function parseXmltv(response, {limitUncompressed=MAX_XML_BYTES}={}) {
 if(!response.ok)throw new Error(`HTTP ${response.status}`);
 if(!response.body)throw new Error('Empty response stream');
 const raw = Readable.fromWeb(response.body);
 const it=raw[Symbol.asyncIterator]();
 const first=await it.next();
 if(first.done)return {channels:[],programmeCount:0,bytes:0};
 const firstBuffer=Buffer.from(first.value);
 const source=Readable.from((async function*(){yield firstBuffer;for await(const chunk of { [Symbol.asyncIterator]:()=>it })yield chunk})());
 const gzip=firstBuffer.length>1 && firstBuffer[0]===0x1f && firstBuffer[1]===0x8b;
 const input=gzip?source.pipe(zlib.createGunzip()):source;
 const decoder=new TextDecoder('utf-8');
 const channels=new Map(); let buffer='',total=0,programmes=0,firstProgramme=null,lastProgramme=null;
 const processBlock=(entry,isChannel)=>{
  const head=entry.slice(0,Math.min(2048,entry.indexOf('>')+1));
  if(isChannel){
   const id=attr(head,'id');if(!id)return;
   const name=field(entry,'display-name')||id;
   const iconMatch=entry.match(/<icon\s+[^>]*src=["']([^"']+)["']/i);
   if(!channels.has(id))channels.set(id,{id,name,icon:iconMatch?unescapeXML(iconMatch[1]):'',cats:classify(name),pr:[]});
   return;
  }
  const id=attr(head,'channel'),s=xmlTime(attr(head,'start')),e=xmlTime(attr(head,'stop'));
  if(!id||s===null||e===null||e<=s||e-s>172800000)return;
  const t=field(entry,'title');if(!t)return;
  let ch=channels.get(id);
  if(!ch){ch={id,name:id,icon:'',cats:classify(id),pr:[]};channels.set(id,ch)}
  ch.pr.push({s,e,t,d:field(entry,'desc').slice(0,700),g:field(entry,'category')});programmes++;
  if(firstProgramme===null||s<firstProgramme)firstProgramme=s;
  if(lastProgramme===null||e>lastProgramme)lastProgramme=e;
 };
 for await(const chunk of input){
  total+=chunk.byteLength;
  if(total>limitUncompressed)throw Error('Source exceeded XML safety limit');
  buffer+=decoder.decode(chunk,{stream:true});
  for(let count=0;count<350000;count++){
   const a=buffer.search(/<channel(?=[\s>])/i), b=buffer.search(/<programme(?=[\s>])/i);
   if(a<0&&b<0){if(buffer.length>300)buffer=buffer.slice(-120);break;}
   const isChannel=a>=0&&(b<0||a<b),start=isChannel?a:b,endTag=isChannel?'</channel>':'</programme>';
   const end=buffer.indexOf(endTag,start);
   if(end<0){if(start>0)buffer=buffer.slice(start);if(buffer.length>1024*1024)throw Error('Malformed XMLTV element');break;}
   processBlock(buffer.slice(start,end+endTag.length),isChannel);
   buffer=buffer.slice(end+endTag.length);
  }
 }
 for(const ch of channels.values())ch.pr.sort((a,b)=>a.s-b.s);
 return {channels:[...channels.values()],programmeCount:programmes,bytes:total,firstProgramme,lastProgramme};
}

function normalizeName(s){
 return String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
 .replace(/^\s*(fr|uk|gb|bg)\s*[-–:]\s*/,'')
 .replace(/\b(ultra hd|fhd|hd|sd|4k|uhd)\b/g,'')
 .replace(/[^\p{L}\p{N}]+/gu,'').trim();
}
function mergeChannel(map,channel,country){
 const key=normalizeName(channel.name)||channel.id;
 const existing=map.get(key);
 if(!existing){map.set(key,{...channel,id:`${country}:${key}`});return;}
 if(!existing.icon&&channel.icon)existing.icon=channel.icon;
 // A single source's overlapping schedules may disagree; prefer the first source's entries.
 const seen=new Set(existing.pr.map(p=>`${p.s}:${p.e}:${p.t}`));
 for(const p of channel.pr){const k=`${p.s}:${p.e}:${p.t}`;if(!seen.has(k)){seen.add(k);existing.pr.push(p)}}
 existing.cats=[...new Set([...existing.cats,...channel.cats])];
}

function validateSnapshot(x){return x&&x.updated&&Array.isArray(x.channels)&&x.channels.length>0;}
async function readDisk(country){
 try{const data=await fs.readFile(path.join(cacheDir,`${country}.json.gz`));const out=JSON.parse(zlib.gunzipSync(data).toString());return validateSnapshot(out)?out:null}catch{return null}
}
async function saveDisk(country,data){
 try{await fs.mkdir(cacheDir,{recursive:true});await fs.writeFile(path.join(cacheDir,`${country}.json.gz`),zlib.gzipSync(JSON.stringify(data),{level:5}));}
 catch(e){console.warn('Cache write failed:',e.message)}
}
export async function fetchOne(feed, remoteFetch=fetch){
 const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),45000);
 try{
  const r=await remoteFetch(feed.url,{signal:abort.signal,redirect:'follow',headers:{'User-Agent':'VIVIO-TV-Guide/1.1','Accept':'application/xml,text/xml,application/gzip,application/octet-stream,*/*'}});
  const len=+(r.headers?.get?.('content-length')||0);
  if(len>MAX_COMPRESSED)throw Error('Source too large');
  const parsed=await parseXmltv(r);
  if(parsed.programmeCount===0)throw Error('No programme entries in feed');
  return parsed;
 }finally{clearTimeout(timer)}
}
export function createFeedManager({sources=FEEDS,remoteFetch=fetch,ttl=TTL,storage=true}={}){
 const countryCache=new Map();const countryInflight=new Map();
 async function refresh(country){
  if(countryInflight.has(country))return countryInflight.get(country);
  const task=(async()=>{
   const prev=countryCache.get(country);
   const byName=new Map(),reports=[];let allEntries=0;let first=null,last=null;
   // At most two upstream downloads simultaneously to limit cold-load latency and RAM use.
   // Responses are merged in provider-priority order, never from arbitrary user-provided URLs.
   const feeds=sources[country];
   for(let index=0;index<feeds.length;index+=2){
    const batch=await Promise.all(feeds.slice(index,index+2).map(async feed=>{
     try{return {feed,data:await fetchOne(feed,remoteFetch)}}
     catch(error){return {feed,error}}
    }));
    for(const {feed,data,error} of batch){
     if(error){reports.push({name:feed.name,url:feed.url,ok:false,error:String(error?.message||error)});continue;}
     reports.push({name:feed.name,url:feed.url,ok:true,channels:data.channels.length,programmes:data.programmeCount});
     for(const ch of data.channels)mergeChannel(byName,ch,country);
     allEntries+=data.programmeCount;
     if(data.firstProgramme!==null)first=first===null?data.firstProgramme:Math.min(first,data.firstProgramme);
     if(data.lastProgramme!==null)last=last===null?data.lastProgramme:Math.max(last,data.lastProgramme);
    }
   }
   if(!byName.size){
    if(prev) return {...prev,stale:true,sourceReports:reports};
    throw Error('Нито един EPG доставчик не върна валидна ТВ програма: '+reports.map(x=>x.name+' '+x.error).join(' | '));
   }
   let channels=[...byName.values()];
   for(const ch of channels){ch.pr.sort((a,b)=>a.s-b.s);}
   channels.sort((a,b)=>a.name.localeCompare(b.name,'bg'));
   const fresh={channels,programmeCount:allEntries,updated:Date.now(),sourceReports:reports,first,last,stale:false};
   countryCache.set(country,fresh);
   if(storage)await saveDisk(country,fresh);
   return fresh;
  })();
  countryInflight.set(country,task);
  try{return await task}finally{countryInflight.delete(country)}
 }
 async function get(country,{force=false}={}){
  if(!countryCache.has(country)&&storage){const disk=await readDisk(country);if(disk)countryCache.set(country,disk)}
  const prev=countryCache.get(country);
  if(!force&&prev){
   if(Date.now()-prev.updated<ttl)return prev;
   // Keep the UI available even when an upstream feed fails. Refresh in the server process.
   void refresh(country).catch(e=>console.error('EPG refresh error',country,e.message));
   return {...prev,stale:true,refreshing:true};
  }
  return refresh(country);
 }
 return {get,refresh,has:country=>countryCache.has(country)};
}
const manager=createFeedManager();
const formatters=new Map();
function zparts(ms,tz){let f=formatters.get(tz);if(!f){f=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});formatters.set(tz,f)}return Object.fromEntries(f.formatToParts(new Date(ms)).filter(x=>x.type!=='literal').map(x=>[x.type,+x.value]));}
function zoneOffset(ms,tz){const p=zparts(ms,tz);return Date.UTC(p.year,p.month-1,p.day,p.hour%24,p.minute,p.second)-Math.floor(ms/1000)*1000;}
function addDays(day,n){let d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function midnight(day,tz){const [y,m,d]=day.split('-').map(Number);const t=Date.UTC(y,m-1,d);let v=t-zoneOffset(t,tz);return t-zoneOffset(v,tz)}
export function dayRange(day,tz){return [midnight(day,tz),midnight(addDays(day,1),tz)]}
export function sliceDay(ds,country,date){
 const [from,to]=dayRange(date,ZONE[country]);let count=0,withData=0;
 const channels=ds.channels.map(ch=>{
  const pr=ch.pr.filter(p=>p.s<to&&p.e>from);
  if(pr.length)withData++;count+=pr.length;
  return {...ch,pr};
 });
 return {country,date,channels,programmeCount:count,channelsWithData:withData,feedChannelCount:ds.channels.length,
  updated:ds.updated,stale:!!ds.stale,refreshing:!!ds.refreshing,coverage:{first:ds.first,last:ds.last},
  sourceReports:ds.sourceReports,sourceMode:'server',sources:ds.sourceReports.filter(x=>x.ok).map(x=>x.url)};
}
const MIME={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
function send(req,res,status,payload,type='application/json; charset=utf-8'){
 const src=typeof payload==='string'?payload:JSON.stringify(payload);const data=Buffer.from(src);
 const headers={'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','vary':'Accept-Encoding','access-control-allow-origin':'*'};
 if((req.headers['accept-encoding']||'').includes('gzip') && data.byteLength>2048){const zipped=zlib.gzipSync(data,{level:5});headers['content-encoding']='gzip';headers['content-length']=zipped.length;res.writeHead(status,headers);res.end(zipped);return}
 headers['content-length']=data.length;res.writeHead(status,headers);res.end(data);
}
export function createAppServer({feedManager=manager}={}){
 return http.createServer(async(req,res)=>{
  if(req.method!=='GET'){send(req,res,405,{error:'Method not allowed'});return}
  let u;try{u=new URL(req.url,'http://localhost')}catch{send(req,res,400,{error:'Bad URL'});return}
  if(u.pathname==='/health'){send(req,res,200,{status:'ok',utc:new Date().toISOString(),countries:Object.keys(ZONE)});return}
  if(u.pathname==='/api/epg'){
   const country=u.searchParams.get('country'),date=u.searchParams.get('date');
   if(!Object.hasOwn(ZONE,country)||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date){send(req,res,400,{error:'country FR/BG/GB and valid YYYY-MM-DD required'});return}
   try{const dataset=await feedManager.get(country,{force:u.searchParams.get('refresh')==='1'});send(req,res,200,sliceDay(dataset,country,date))}
   catch(e){send(req,res,502,{error:e.message})}return;
  }
  const file=u.pathname==='/'?'index.html':u.pathname.slice(1);
  if(!['index.html','manifest.json','icon.svg'].includes(file)){send(req,res,404,{error:'Not found'});return}
  try{const b=await fs.readFile(path.join(publicDir,file));res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream','cache-control':'no-cache','content-length':b.length});res.end(b)}
  catch{send(req,res,404,{error:'Not found'})}
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))createAppServer().listen(PORT,HOST,()=>console.log(`VIVIO TV Guide at http://${HOST}:${PORT}`));
