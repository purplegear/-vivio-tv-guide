// One-time availability probe for public TV data feeds. 
// No feed data is republished, only status/format metadata is logged.
const feeds=[
  ["TvProfil TvSchedule RSS","https://tvprofil.com/rss/feed/channel-group-1.xml"],
  ["TvProfil SportLive RSS","https://tvprofil.com/rss/feed/sportLive.xml"],
  ["TvProfil TopMovies RSS","https://tvprofil.com/rss/feed/topmovies.xml"],
  ["France evening RSS","https://tv-programme.com/feed-programme-tv-soir"],
  ["France sport RSS","https://tv-programme.com/feed-sports"],
  ["UK TV Guide feed","https://uktvguide.co.uk/feed/"],
  ["TvProfil free XMLTV","https://tvprofil.net/xmltv/epg_tvprofil.net.xml"],
  ["UK onTVnow XMLTV","https://www.ontvnow.co.uk/api/v1/listings.xml"]
];
const tagCount=(s,t)=> (s.match(new RegExp('<(?:[a-z0-9]+:)?'+t+'(?:[\\s>])','gi'))||[]).length;
async function check([name,url]){
 const start=Date.now();
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),17000);
 try{
  const r=await fetch(url,{signal:ac.signal,redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; VIVIO-TVGuide-FeedCheck/1.0)','Accept':'application/rss+xml,application/atom+xml,application/xml,text/xml,text/html,*/*'}});
  let chunks=[],n=0;
  try{
   if(r.body){
    const reader=r.body.getReader();
    for(let i=0;i<60;i++){
     const {done,value}=await reader.read();
     if(done)break;
     chunks.push(value);n+=value.byteLength;
     if(n>=100000)break;
    }
    await reader.cancel().catch(()=>{});
   }
  }catch(e){ /* partial response inspection */ }
  const bytes=Buffer.concat(chunks);
  const compressed=bytes[0]===31&&bytes[1]===139;
  const s=compressed?'[compressed xmltv]':bytes.toString('utf8');
  const xmltv=/<tv[\s>]/i.test(s)||compressed;
  const rss=/<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(s);
  const result={name,status:r.status,contentType:r.headers.get('content-type'),bytesSampled:n,ms:Date.now()-start,isRSS:rss,isXMLTV:xmltv,
    items:tagCount(s,'item'),entries:tagCount(s,'entry'),channelElements:tagCount(s,'channel'),programmeElements:tagCount(s,'programme'),
    descriptionTags:tagCount(s,'description'),summaryTags:tagCount(s,'summary'),pubDates:tagCount(s,'pubDate'),
    epgStartAttrs:(s.match(/<programme[^>]*start=/ig)||[]).length,endsAt:r.url};
  console.log(JSON.stringify(result));
 }catch(e){console.log(JSON.stringify({name,error:String(e.message||e),ms:Date.now()-start}));}
 finally{clearTimeout(timer)}
}
await Promise.all(feeds.map(check));
