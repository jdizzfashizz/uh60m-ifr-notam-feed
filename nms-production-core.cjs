'use strict';
const HOST='https://api-nms.aim.faa.gov';
const INCREMENT_MS=180000,BULK_MS=86400000,STALE_MS=12*60000;
const crypto=require('node:crypto');
function iso(value){
 if(typeof value!=='string')return null;value=value.trim().replace(/\s*EST$/i,'');
 if(/^\d{12}$/.test(value))value=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:00Z`;
 if(!/^\d{4}-\d\d-\d\dT/.test(value)||!Number.isFinite(Date.parse(value)))return null;
 return new Date(value).toISOString();
}
function normalize(n,translations=[],meta={}){
 const type=String(n.type||'').replace('OTHER:','').toUpperCase();
 let number=String(n.number||'');
 if(!number.includes('/')&&n.year)number=String(n.series||'')+number.padStart(4,'0')+'/'+String(n.year).slice(-2);
 const locations=[...new Set([n.location,n.icaoLocation,meta.icaoLocation].filter(x=>typeof x==='string').flatMap(x=>x.toUpperCase().split(/[\s,]+/)).filter(x=>/^[A-Z0-9]{3,4}$/.test(x)))];
 const text=String(n.text||'').trim(),start=iso(n.effectiveStart),end=iso(n.effectiveEnd),permanent=/^(PERM|PERMANENT)$/i.test(n.effectiveEnd||'');
 const formatted=translations.map(t=>String(t.formattedText||t.simpleText||'').trim()).filter(Boolean);
 const originalText=formatted[0]||'';const displayText=originalText.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/?b>/gi,'');const domestic=displayText.match(/^!([A-Z0-9]+)\s+(\d{2}\/\d+)/);const icao=displayText.match(/^([A-Z]\d{3,4}\/\d{2})\s+NOTAM/);if(domestic)number=domestic[2];else if(icao)number=icao[1];else{const local=displayText.match(/^(\d{2}\/\d{2,5})\s+NOTAM/);if(local)number=local[1];}
 const aLine=displayText.match(/\bA\)\s*([\s\S]*?)\bB\)/);if(aLine)for(const code of aLine[1].toUpperCase().split(/\s+/))if(/^[A-Z0-9]{4}$/.test(code)&&!locations.includes(code))locations.push(code);
 const classification=String(n.classification||meta.classification||'UNKNOWN');
 const account=String(n.accountId||meta.accountId||locations[0]||'');
 const canonical=account+'|'+number+'|'+String(n.year||iso(n.issued)?.slice(0,4)||'')+'|'+[...locations].sort().join(',')+(!originalText?'|UNVERIFIED|'+String(n.id||n.text)+'|'+locations.join(','):'');
 const key=crypto.createHash('sha256').update(canonical).digest('hex');
 return {key,rawNumber:String(n.number||''),series:String(n.series||''),year:String(n.year||iso(n.issued)?.slice(0,4)||''),nmsId:String(n.id||''),identifier:number,classification,account,locations,type,text,originalText,displayText,translations:formatted,
  effectiveStart:start,effectiveEnd:end,permanent,estimatedEnd:/EST$/i.test(n.effectiveEnd||''),schedule:String(n.schedule||''),
  lastUpdated:iso(n.lastUpdated||meta.lastUpdated||n.issued),issued:iso(n.issued),
  referredNumber:n.referredNumber?String(n.referredNumber):null,referredSeries:String(n.referredSeries||''),referredYear:String(n.referredYear||''),
  incomplete:!number||!locations.length||!text||!originalText||!start||(!end&&!permanent),source:'FAA NMS production'};
}
function parseIncrement(result){
 if(!result||String(result.status).toLowerCase()!=='success'||result.errors?.length||!Array.isArray(result.data?.geojson))throw Error('FAA response schema invalid');
 return result.data.geojson.map(f=>{
  const core=f?.properties?.coreNOTAMData,n=core?.notam;
  if(f?.type!=='Feature'||!n||typeof n!=='object'||!n.id||!n.number||!n.lastUpdated)throw Error('FAA NOTAM record schema invalid');
  return normalize(n,core.notamTranslation||[]);
 });
}
function mergeRecords(old,incoming,now=Date.now()){
 const map=new Map(old.map(r=>[r.key,r]));
 for(const r of incoming){
  if(!r.key||!r.identifier||!r.lastUpdated)throw Error('NOTAM identity/update missing');
  // Cancellation/replacement references remove only an exact referenced identity.
  // Unknown links remain visible and explicitly incomplete rather than guessed away.
  if(['C','R'].includes(r.type)&&r.referredNumber){
   let ref=r.referredNumber;
   if(!ref.includes('/')&&r.referredYear)ref=r.referredSeries+ref.padStart(4,'0')+'/'+r.referredYear.slice(-2);
   for(const [key,prior]of map)if(prior.account===r.account&&prior.locations.some(x=>r.locations.includes(x))&&(prior.identifier===ref||(prior.rawNumber===r.referredNumber&&prior.series===r.referredSeries&&prior.year===r.referredYear)))map.delete(key);
  }
  const prior=map.get(r.key);
  if(prior&&Date.parse(prior.lastUpdated)>Date.parse(r.lastUpdated))continue;
  map.set(r.key,r);
 }
 return [...map.values()].filter(r=>!r.effectiveEnd||Date.parse(r.effectiveEnd)>=now-86400000);
}
function airportView(snapshot,airport,now=Date.now()){
 if(!/^[A-Z0-9]{3,4}$/.test(airport))throw Error('Invalid airport');
 const stamp=iso(snapshot?.lastSuccessfulSync),stale=!stamp||now-Date.parse(stamp)>STALE_MS;
 const aliases=new Set([airport]);if(/^K[A-Z0-9]{3}$/.test(airport))aliases.add(airport.slice(1));
 const all=(snapshot?.records||[]).filter(r=>r.locations.some(x=>aliases.has(x)));
 const records=all.filter(r=>r.type!=='C'&&(!r.effectiveEnd||r.estimatedEnd||Date.parse(r.effectiveEnd)>=now));
 const incompleteRecords=records.filter(r=>r.incomplete).length;
 return {environment:'production',staleAfterSeconds:720,connected:!!stamp,source:'FAA NMS production · shared server cache',airport,
  lastSuccessfulSync:stamp,lastSuccessfulBulk:snapshot?.lastSuccessfulBulk||null,stale,incomplete:stale||incompleteRecords>0||!!snapshot?.syncError,
  completeBriefing:false,scope:'Airport/location-associated NOTAMs only. Route, FIR, airspace, GPS and unassociated notices may be outside this view. Obtain a complete official briefing.',
  status:stale?'STALE — do not treat as a current briefing':snapshot?.syncError?'SYNC FAILED — cached records only':'Cached production records — pilot verification required',
  coverageThrough:snapshot?.coverageThrough||null,syncError:!!snapshot?.syncError,incompleteRecords,records};
}
function reserve(state,kind,now=Date.now()){
 if(state.leaseUntil>now)return null;
 if(now-(state.lastDataAttempt||0)<INCREMENT_MS)return null;
 if(kind==='bulk'&&now-(state.lastBulkAttempt||0)<BULK_MS)return null;
 return {...state,lastDataAttempt:now,...(kind==='bulk'?{lastBulkAttempt:now}:{}),leaseUntil:now+9*60000,leaseId:crypto.randomUUID()};
}
function createClient(secretProvider,request=fetch,now=Date.now){
 let access=null,expires=0,pending;
 async function bearer(){
  if(access&&now()<expires)return access;
  if(!pending)pending=(async()=>{
   const {clientId,clientSecret}=await secretProvider();if(!clientId||!clientSecret)throw Error('Server credentials unavailable');
   const r=await request(HOST+'/v1/auth/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
   if(!r.ok)throw Error('FAA authentication HTTP '+r.status);
   const t=await r.json();if(typeof t.access_token!=='string'||!t.access_token||Number(t.expires_in)<=60)throw Error('FAA authentication response invalid');
   access=t.access_token;expires=now()+(Number(t.expires_in)-60)*1000;return access;
  })().finally(()=>{pending=null;});
  return pending;
 }
 async function get(path){
  if(!path.startsWith('/nmsapi/v1/'))throw Error('FAA path refused');
  return request(HOST+path,{redirect:'manual',signal:AbortSignal.timeout(120000),headers:{Authorization:'Bearer '+await bearer(),nmsResponseFormat:'GEOJSON'}});
 }
 return {async incremental(since){const r=await get('/nmsapi/v1/notams?lastUpdatedDate='+encodeURIComponent(since));if(!r.ok)throw Error('FAA incremental HTTP '+r.status);return parseIncrement(await r.json());},
  async bulkStream(){const r=await get('/nmsapi/v1/notams/il?allowRedirect=false');if(!r.ok)throw Error('FAA bulk HTTP '+r.status);const j=await r.json();if(String(j.status).toLowerCase()!=='success'||j.errors?.length)throw Error('FAA bulk response invalid');let path=j.data?.url;if(typeof path!=='string')throw Error('FAA bulk content path missing');if(path.startsWith('/v1/content/'))path='/nmsapi'+path;if(!/^\/nmsapi\/v1\/content\/[A-Za-z0-9_+/=.-]+$/.test(path))throw Error('FAA bulk content path refused');const data=await get(path);if(!data.ok||!data.body)throw Error('FAA content HTTP '+data.status);return data.body;}};
}
module.exports={normalize,iso,parseIncrement,mergeRecords,airportView,reserve,createClient,INCREMENT_MS,BULK_MS,STALE_MS};
