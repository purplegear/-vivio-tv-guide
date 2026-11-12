/** Build a completely static, free TV guide from public sources.
 * Run by GitHub Actions every six hours. Never invent schedules.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createFeedManager, sliceDay, FEEDS} from '../server.js';

const OUTPUT = path.resolve('docs/data');
const COUNTRY_CODES = ['FR','BG','GB'];
const ZONES = {FR:'Europe/Paris',BG:'Europe/Sofia',GB:'Europe/London'};
const todayLocal = (country, date=new Date()) => {
 const pieces = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: ZONES[country],year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return `${pieces.year}-${pieces.month}-${pieces.day}`;
};
const datePlus=(value,n)=>{const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
export function makeDaySnapshot(ds,country,date){
 const day=sliceDay(ds,country,date);
 // Include ALL channels available from the source, even if listings are absent for this date.
 return {version:1,...day,sourceMode:'static',channels:day.channels};
}
async function writeJSON(file,obj){await fs.mkdir(path.dirname(file),{recursive:true});const content=JSON.stringify(obj);await fs.writeFile(file,content+'\n');}
export async function build({manager=createFeedManager({storage:false}),countries=COUNTRY_CODES,output=OUTPUT}={}){
 await fs.mkdir(output,{recursive:true});
 const result={version:1,generatedAt:new Date().toISOString(),countries:{}};
 for(const country of countries){
  const reports=[];
  try{
   const ds=await manager.get(country,{force:true});
   const today=todayLocal(country);let days=[];
   for(let step=-1;step<=7;step++){
    const day=datePlus(today,step);
    const snapshot=makeDaySnapshot(ds,country,day);
    if(snapshot.programmeCount===0)continue;
    await writeJSON(path.join(output,country,`${day}.json`),snapshot);
    days.push({date:day,programmes:snapshot.programmeCount,channelsWithData:snapshot.channelsWithData});
   }
   result.countries[country]={ok:days.length>0,updated:ds.updated,channels:ds.channels.length,days,sourceReports:ds.sourceReports};
   if(!days.length)result.countries[country].error='Няма актуална програма за избраната дата';
   console.log(country,ds.channels.length,'channels;',days.length,'days;',ds.sourceReports.map(r=>r.name+':'+(r.ok?'ok':r.error)).join(', '));
  }catch(error){
   const msg=String(error?.message||error);
   // Do not remove last successful files. A failed update must never invent content.
   result.countries[country]={ok:false,error:msg};
   console.error(country,msg);
  }
 }
 await writeJSON(path.join(output,'status.json'),result);
 return result;
}
if(process.argv[1] && path.resolve(process.argv[1])===new URL(import.meta.url).pathname){
 await build();
}
