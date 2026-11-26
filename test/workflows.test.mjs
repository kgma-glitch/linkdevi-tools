import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';import vm from 'node:vm';import {createHash} from 'node:crypto';
const dir=new URL('../workflows/',import.meta.url);
const files=readdirSync(dir).filter(f=>f.endsWith('.json'));
const run=(source,items)=>vm.runInNewContext(`(function(){${source}\n})()`,{$input:{all:()=>items}},{timeout:1000});
test('three portable workflows are inactive, preserve credentials boundaries and stop on request errors',()=>{
 assert.equal(files.length,3);
 for(const f of files){const w=JSON.parse(readFileSync(new URL(f,dir),'utf8'));assert.equal(w.active,false);const names=new Set(w.nodes.map(n=>n.name));assert.equal(names.size,w.nodes.length);assert.ok(w.nodes.some(n=>n.type==='n8n-nodes-base.manualTrigger'));const h=w.nodes.find(n=>n.name==='Create saved campaign');assert.equal(h.retryOnFail,false);assert.equal(h.parameters.url,'https://linkdevi.com/api/v1/agent');assert.equal(h.parameters.authentication,'genericCredentialType');assert.equal(h.parameters.options.redirect.redirect.followRedirects,false);assert.equal(h.credentials,undefined);assert.ok(!JSON.stringify(w).includes('su_'));for(const [source,edge] of Object.entries(w.connections)){assert.ok(names.has(source));for(const branch of edge.main)for(const target of branch)assert.ok(names.has(target.node));}}
});
test('Sheets requires pre-saved unique IDs, skips completed rows and preserves pairing',()=>{
 const w=JSON.parse(readFileSync(new URL(files[0],dir),'utf8')),source=w.nodes.find(n=>n.name==='Prepare campaign rows').parameters.jsCode;
 const row={requestId:'a43c37c0-350a-44ef-9d40-a5900c246891',name:'Launch',url:'https://example.com',utmCampaign:'launch',channels:'facebook|line'};
 const r=run(source,[{json:{...row,shortUrls:'https://example.test/already'}},{json:row}]);assert.equal(r.length,1);assert.equal(r[0].pairedItem.item,1);assert.equal(r[0].json.campaign.requestId,row.requestId);assert.throws(()=>run(source,[{json:{...row,requestId:''}}]));assert.throws(()=>run(source,[{json:row},{json:row}]));
 const writer=w.nodes.find(n=>n.name==='Write links to sheet');assert.deepEqual(writer.parameters.columns.matchingColumns,['requestId']);assert.equal(writer.parameters.options.cellFormat,'RAW');
});
test('RSS stable hash produces a repeatable UUID and CSV rows neutralize formulas',()=>{
 const w=JSON.parse(readFileSync(new URL(files[2],dir),'utf8'));const source=w.nodes.find(n=>n.name==='Prepare article campaigns').parameters.jsCode;
 const digest=createHash('sha256').update('fixture-feed\nguid-1').digest('hex'),items=[{json:{digest,name:'=SUM(1,2)',url:'https://example.com/article'}}];const a=run(source,items),b=run(source,items);assert.equal(a[0].json.campaign.requestId,b[0].json.campaign.requestId);assert.match(a[0].json.campaign.requestId,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 const flatten=w.nodes.find(n=>n.name==='CSV rows').parameters.jsCode;const rows=run(flatten,[{json:{campaign:{name:'=SUM(1,2)',channels:[{key:'line',link:{shortUrl:'https://example.test/a',url:'https://example.com'}}]}}}]);assert.equal(rows[0].json.campaign,"'=SUM(1,2)");
});
