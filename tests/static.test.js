import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {makeDaySnapshot,build} from '../scripts/build-data.js';

const date='2026-11-12';
const base={updated:Date.parse('2026-11-12T06:00:00Z'),sourceReports:[{name:'test XMLTV',ok:true}],first:Date.parse('2026-11-12T08:00:00Z'),last:Date.parse('2026-11-13T08:00:00Z'),channels:[{id:'test:CanalPlus',name:'CANAL+ Sport',cats:['sport'],icon:'',pr:[{s:Date.parse('2026-11-12T19:00:00Z'),e:Date.parse('2026-11-12T20:00:00Z'),t:'Test match',d:'Fixture only'}]}]};

test('daily published JSON contains actual input titles and hours, never fabricated records',()=>{
 const output=makeDaySnapshot(base,'FR',date);
 assert.equal(output.programmeCount,1);
 assert.equal(output.channelsWithData,1);
 assert.equal(output.channels[0].pr[0].t,'Test match');
 assert.equal(makeDaySnapshot(base,'FR','2026-11-20').programmeCount,0);
 assert.equal(output.sourceMode,'static');
});

test('static exporter handles independent country failures and only emits days with programmes',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'vivio-static-'));
 const m={get:async c=>c==='BG'?Promise.reject(new Error('HTTP 401')):base};
 try{
  const out=await build({manager:m,countries:['FR','BG'],output:folder});
  assert.equal(out.countries.FR.ok,true); // only records from the input snapshot, never invented
  assert.equal(out.countries.BG.ok,false);
  const fr=JSON.parse(await fs.readFile(path.join(folder,'FR',date+'.json')));
  assert.equal(fr.channels[0].pr[0].t,'Test match');
  const json=JSON.parse(await fs.readFile(path.join(folder,'status.json')));
  assert.match(json.countries.BG.error,/HTTP 401/);
 }finally{await fs.rm(folder,{recursive:true,force:true})}
});
