import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {parseXmltv, dayRange, createAppServer, createFeedManager, classify, FEEDS} from '../server.js';

const xml=`<?xml version="1.0" encoding="UTF-8"?><tv>
<channel id="a"><display-name>CANAL+ Cinéma</display-name><icon src="https://example.com/canal.png"/></channel>
<channel id="b"><display-name>БНТ 1</display-name></channel>
<channel id="c"><display-name>TMC HD</display-name></channel>
<programme start="20261112193000 +0100" stop="20261112203000 +0100" channel="a"><title lang="fr">Le journal &amp; le cinéma</title><desc>Actualité du cinéma</desc><category>News</category></programme>
<programme start="20261112190000 +0200" stop="20261112200000 +0200" channel="b"><title>По света и у нас</title></programme>
<programme start="20261112200000 +0100" stop="20261112210000 +0100" channel="c"><title>Quotidien</title></programme></tv>`;
const bad=new Response('Not authorized',{status:401});
const ok=(x,gzip=false)=>new Response(gzip?zlib.gzipSync(Buffer.from(x)):Buffer.from(x),{status:200,headers:{'content-type':gzip?'application/gzip':'application/xml'}});
const fakeFeeds={FR:[{name:'bad',url:'https://unit.test/401'},{name:'good gzip',url:'https://unit.test/good'}],BG:[{name:'good plain',url:'https://unit.test/plain'}],GB:[{name:'good gzip',url:'https://unit.test/good'}]};
const mockFetch=async url=>url.endsWith('/401')?bad:url.endsWith('/plain')?ok(xml):ok(xml,true);
const manager=()=>createFeedManager({sources:fakeFeeds,remoteFetch:mockFetch,storage:false});

test('streaming parser reads gzip XMLTV, titles and accents, real programme hours',async()=>{
 const result=await parseXmltv(ok(xml,true));
 assert.equal(result.channels.length,3);
 assert.equal(result.programmeCount,3);
 assert.equal(result.channels.find(x=>x.name==='БНТ 1').pr[0].t,'По света и у нас');
 assert.equal(result.channels.find(x=>x.name==='CANAL+ Cinéma').pr[0].s,Date.parse('2026-11-12T18:30:00Z'));
});
test('backup succeeds after HTTP 401 and keeps source warnings',async()=>{
 const ds=await manager().get('FR');
 assert.equal(ds.channels.length,3);
 assert.equal(ds.sourceReports.length,2);
 assert.equal(ds.sourceReports[0].ok,false);
 assert.equal(ds.sourceReports[1].ok,true);
});
test('Bulgarian channel names are retained and not collapsed',async()=>{
 const ds=await manager().get('BG');
 assert.deepEqual(ds.channels.map(x=>x.name).sort(),['CANAL+ Cinéma','TMC HD','БНТ 1'].sort());
});
test('DST time handling uses 23h/25h local dates',()=>{
 assert.equal((dayRange('2026-03-29','Europe/Paris')[1]-dayRange('2026-03-29','Europe/Paris')[0])/3600000,23);
 assert.equal((dayRange('2026-10-25','Europe/Paris')[1]-dayRange('2026-10-25','Europe/Paris')[0])/3600000,25);
});
test('server returns real day listings and rejects invalid dates and URLs',async()=>{
 const app=createAppServer({feedManager:manager()}); await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const root=`http://127.0.0.1:${app.address().port}`;
 try{
  assert.equal((await (await fetch(root+'/health')).json()).status,'ok');
  assert.equal((await fetch(root+'/api/epg?country=AB&date=2026-11-12')).status,400);
  assert.equal((await fetch(root+'/api/epg?country=FR&date=2026-19-31')).status,400);
  const guide=await (await fetch(root+'/api/epg?country=FR&date=2026-11-12')).json();
  assert.equal(guide.programmeCount,3);assert.equal(guide.channelsWithData,3);
  assert.ok(guide.channels.some(x=>x.pr.some(p=>p.t==='Quotidien')));
  assert.equal((await (await fetch(root+'/api/epg?country=FR&date=2026-12-12')).json()).programmeCount,0);
  assert.match(await (await fetch(root+'/')).text(),/VIVIO TV Guide/);
 }finally{await new Promise(r=>app.close(r))}
});
test('no fabricated programmes when sources are unavailable',async()=>{
 const local=createFeedManager({sources:{FR:[{name:'bad',url:'https://unit.test/401'}]},remoteFetch:mockFetch,storage:false});
 await assert.rejects(()=>local.get('FR'),/Нито един EPG доставчик/);
});
test('category mapping includes channels like CANAL+ Sport and TMC',()=>{
 assert.ok(classify('CANAL+ Sport').includes('sport'));
 assert.ok(classify('БНТ 1').includes('general'));
});
