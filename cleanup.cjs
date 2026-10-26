'use strict';
// Only this dedicated feed repository's generated artifacts/cache are touched.
const repo=process.env.GITHUB_REPOSITORY;
if(!/^[A-Za-z0-9_.-]+\/uh60m-ifr-notam-feed$/.test(repo||''))throw Error('Unexpected repository');
async function api(path,method='GET'){
 const r=await fetch('https://api.github.com/repos/'+repo+path,{method,redirect:'error',headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
 if(!r.ok&&r.status!==404)throw Error('GitHub cleanup failed HTTP '+r.status);
 return r.status===204||r.status===404?{}:r.json();
}
(async()=>{
 const artifacts=await api('/actions/artifacts?per_page=100');
 for(const a of artifacts.artifacts||[])if(a.name==='github-pages')await api('/actions/artifacts/'+a.id,'DELETE');
 const caches=await api('/actions/caches?per_page=100&sort=created_at&direction=desc');
 const own=(caches.actions_caches||[]).filter(c=>c.key.startsWith('nms-snapshot-'));
 for(const c of own.slice(3))await api('/actions/caches/'+c.id,'DELETE');
 console.log('Generated deployment artifacts removed; at most three recent feed caches retained.');
})().catch(()=>{console.error('Generated storage cleanup failed; publication step must not accumulate artifacts.');process.exit(1)});
