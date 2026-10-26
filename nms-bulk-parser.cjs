'use strict';
// Streaming parsing avoids expanding the 370+ MB AIXM document into a DOM.
const {SaxesParser}=require('saxes');
const {normalize}=require('./nms-production-core.cjs');
const {StringDecoder}=require('node:string_decoder');
async function parseBulk(stream){
 const parser=new SaxesParser(),decoder=new StringDecoder('utf8'),stack=[],records=[];
 let event=null,capture=null,translation=null,bytes=0,notamCount=0;
 parser.on('doctype',()=>{throw Error('DTD forbidden');});
 parser.on('error',()=>{throw Error('Invalid FAA XML');});
 parser.on('opentag',tag=>{
  const name=tag.name.split(':').at(-1);stack.push(name);
  if(name==='Event')event={n:{},meta:{},translations:[]};
  if(!event)return;
  if(name==='NOTAM'){notamCount++;event.n.id=Object.values(tag.attributes).find(x=>String(x).startsWith('NOTAM_'))||'';}
  if(name==='NOTAMTranslation')translation={};
  if(['formattedText','simpleText'].includes(name)&&translation)capture={name,depth:stack.length,text:'',target:translation};
  else if(!capture&&!['translation','extension'].includes(name)&&['NOTAM','EventExtension','NOTAMTranslation'].includes(stack.at(-2)))capture={name,depth:stack.length,text:'',target:stack.at(-2)==='NOTAM'?event.n:stack.at(-2)==='EventExtension'?event.meta:translation};
 });
 parser.on('text',text=>{if(capture)capture.text+=text;});
 parser.on('cdata',text=>{if(capture)capture.text+=text;});
 parser.on('closetag',tag=>{
  const name=tag.name.split(':').at(-1);
  if(capture&&capture.depth===stack.length){if(capture.target)capture.target[capture.name]=capture.text.trim();capture=null;}
  if(name==='NOTAMTranslation'&&translation){event?.translations.push(translation);translation=null;}
  if(name==='Event'&&event){if(event.n.number){const r=normalize(event.n,event.translations,event.meta);if(!r.identifier||!r.lastUpdated)throw Error('FAA bulk identity missing');records.push(r);}event=null;}
  stack.pop();
 });
 for await(const chunk of stream){bytes+=chunk.length;if(bytes>650*1024*1024)throw Error('FAA bulk exceeds size bound');parser.write(decoder.write(chunk));}
 parser.write(decoder.end()).close();
 if(records.length<1000||records.length!==notamCount)throw Error('FAA bulk record reconciliation failed');
 return records;
}
async function parseContent(stream){const {Readable}=require('node:stream'),it=stream[Symbol.asyncIterator](),first=await it.next();if(first.done)throw Error('FAA content is empty');const raw=Readable.from((async function*(){yield first.value;for(;;){const n=await it.next();if(n.done)break;yield n.value;}})());const magic=Buffer.from(first.value);return parseBulk(magic[0]===31&&magic[1]===139?raw.pipe(require('node:zlib').createGunzip()):raw);}
module.exports={parseBulk,parseContent};
