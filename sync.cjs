'use strict';
// Credentials are read exclusively from encrypted GitHub Actions secrets. Never
// put them in command arguments, repository files, generated assets or console output.
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),{Readable}=require('node:stream');
const {createClient,reserve,mergeRecords,airportView,BULK_MS}=require('./nms-production-core.cjs');
const {parseContent}=require('./nms-bulk-parser.cjs');
const ledgerFile='state/ledger.json',snapshotFile='runtime/snapshot.json.gz';
function read(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function snapshot(){const file=fs.existsSync(snapshotFile)?snapshotFile:'seed/snapshot.json.gz';return JSON.parse(z.gunzipSync(fs.readFileSync(file)));}
function writeLedger(state){fs.mkdirSync('state',{recursive:true});fs.writeFileSync(ledgerFile,JSON.stringify(state,null,2)+'\n');}
function githubOutput(key,value){if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,key+'='+value+'\n');}
async function run(mode){
 const state=read(ledgerFile),now=Date.now();
 if(mode==='reserve'){
  const kind=now-Date.parse(state.lastSuccessfulBulk||0)>=BULK_MS?'bulk':'incremental';
  const next=reserve(state,kind,now);
  if(!next){githubOutput('pull','false');console.log('FAA pull skipped: shared time limit or lease remains active.');return;}
  // The workflow MUST commit this reservation before calling the FAA. A failed
  // or interrupted request still consumes its 3-minute or 24-hour allowance.
  next.kind=kind;next.reservedBy=process.env.GITHUB_RUN_ID||'local-test';writeLedger(next);githubOutput('pull','true');return;
 }
 if(mode==='pull'){
  if(state.reservedBy!==process.env.GITHUB_RUN_ID||state.leaseUntil<now)throw Error('FAA request lacks committed current-run reservation');
  const prior=snapshot(),started=state.lastDataAttempt;
  try{
   const client=createClient(async()=>({clientId:process.env.FAA_NMS_PRODUCTION_CLIENT_ID,clientSecret:process.env.FAA_NMS_PRODUCTION_CLIENT_SECRET}));
   let records,coverageThrough,lastSuccessfulBulk;
   if(state.kind==='bulk'){
    const stream=await client.bulkStream();records=await parseContent(Readable.fromWeb(stream));
    records=mergeRecords([],records,started);coverageThrough=new Date(started-23*3600000).toISOString();lastSuccessfulBulk=new Date(started).toISOString();
   }else{
    const since=Date.parse(prior.coverageThrough)-60000;
    if(!Number.isFinite(since)||now-since>=BULK_MS)throw Error('Coverage gap exceeds FAA incremental window; wait for allowed daily recovery');
    const incoming=await client.incremental(new Date(since).toISOString());records=mergeRecords(prior.records,incoming,started);
    coverageThrough=new Date(started).toISOString();lastSuccessfulBulk=prior.lastSuccessfulBulk;
   }
   const next={schema:1,environment:'production',records,coverageThrough,lastSuccessfulBulk,lastSuccessfulSync:new Date().toISOString(),baselinePendingCatchup:state.kind==='bulk',syncError:false};
   fs.mkdirSync('runtime',{recursive:true});const temp=snapshotFile+'.tmp';fs.writeFileSync(temp,z.gzipSync(JSON.stringify(next)));fs.renameSync(temp,snapshotFile);
   writeLedger({...state,leaseUntil:0,syncError:false,lastSuccessfulSync:next.lastSuccessfulSync,lastSuccessfulBulk,coverageThrough});
   console.log('Production synchronization validated; '+records.length+' shared records retained. No complete-briefing claim.');
  }catch(e){writeLedger({...state,leaseUntil:0,syncError:true});console.error('FAA synchronization failed; previous snapshot and its actual timestamp retained.');process.exitCode=1;}
  return;
 }
 if(mode==='publish'){
  const data={...snapshot(),syncError:!!state.syncError};
  const codes=new Set(read('airports.json')),byCode=new Map();for(const r of data.records)for(const code of r.locations){codes.add(code);if(!byCode.has(code))byCode.set(code,[]);byCode.get(code).push(r);}
  fs.mkdirSync('site/airports',{recursive:true});fs.writeFileSync('site/.nojekyll','');
  for(const code of [...codes].sort()){
   const candidates=[...new Map([...(byCode.get(code)||[]),...(/^K[A-Z0-9]{3}$/.test(code)?byCode.get(code.slice(1))||[]:[])].map(r=>[r.key,r])).values()];const view=airportView({...data,records:candidates},code,now);if(data.baselinePendingCatchup){view.incomplete=true;view.status='Initial load awaiting incremental catch-up — incomplete';}
   fs.writeFileSync('site/airports/'+code+'.json',JSON.stringify(view));
  }
  const status=airportView(data,'ZZZZ',now);delete status.records;
  status.feed='GitHub Pages shared FAA production cache';status.recordCount=data.records.length;status.scheduledIntervalMinutes=5;
  status.scheduleWarning='GitHub scheduled jobs may be delayed or disabled. Age is determined from lastSuccessfulSync, never the page publication time.';
  if(data.baselinePendingCatchup){status.incomplete=true;status.status='Initial load awaiting incremental catch-up — incomplete';}
  fs.writeFileSync('site/status.json',JSON.stringify(status));
  fs.writeFileSync('site/index.html','<!doctype html><meta charset="utf-8"><title>UH-60M IFR NOTAM Cache</title><h1>FAA production NOTAM cache</h1><p>Cached advisory data for the UH-60M IFR Planner. Not a complete official briefing. Check status.json for the actual last successful synchronization. No credentials are published.</p>');
  console.log('Airport-scoped feed generated with source, original text, UTC times, coverage and freshness status.');return;
 }
 throw Error('Unknown mode');
}
if(require.main===module)run(process.argv[2]).catch(()=>{console.error('Feed operation failed. No secrets or FAA response bodies are logged.');process.exitCode=1;});
module.exports={run};
