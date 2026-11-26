import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { LinkDeviClient, LinkDeviError, previewCampaign, launchCsv, parseCsv, planCsvImport, validateCampaign } from "../dist/index.js";
const draft = { requestId:"a43c37c0-350a-44ef-9d40-a5900c246891",name:"Launch ไทย",url:"https://example.com/sale?keep=a&utm_source=old&UTM_CONTENT=old#part",utmCampaign:"launch-ไทย",domain:"linkdevi.com",channels:["facebook","line","print"] };
test("offline UTM preview retains destination data and replaces all old tracking values", () => {
  const p=previewCampaign(draft); assert.equal(p.createsResources,false);assert.equal(p.linksToCreate,3);
  const u=new URL(p.channels[1].destinationUrl);assert.equal(u.searchParams.get("keep"),"a");assert.equal(u.hash,"#part");assert.equal(u.searchParams.get("utm_source"),"line");assert.equal(u.searchParams.get("utm_medium"),"messaging");assert.equal(u.searchParams.get("utm_campaign"),"launch-ไทย");assert.equal(u.searchParams.has("UTM_CONTENT"),false);
  for(const patch of [{channels:["line","line"]},{channels:[]},{channels:["unknown"]},{url:"ftp://example.com"},{url:"https://user:secret@example.com"},{name:"bad\nname"},{url:"https://example.com/"+"x".repeat(2010)},{extra:true}])assert.throws(()=>validateCampaign({...draft,...patch}));
  assert.throws(()=>validateCampaign({...draft,requestId:undefined},true));
});
test("CSV round trip supports quoted commas/newlines and prevents formula execution", () => {
  const csv=launchCsv({...draft,name:'=SUM(1,2) "ไทย"'});const rows=parseCsv(csv);assert.equal(rows.length,4);assert.equal(rows[1][0],'\'=SUM(1,2) "ไทย"');assert.equal(rows[1].at(-1),"preview_only");assert.deepEqual(parseCsv('a,b\r\n"one\ntwo","x""y"'),[["a","b"],["one\ntwo",'x"y']]);
  assert.throws(()=>parseCsv('a\n"unfinished'));assert.throws(()=>parseCsv('a\n"closed"junk'));assert.throws(()=>parseCsv("x".repeat(262145)));
  assert.throws(()=>parseCsv("ก".repeat(90000)),/256 KiB/);
});
test("CSV import is a bounded offline plan with visible invalid and duplicate rows", () => {
  const csv='url,name,utmCampaign,channels\nhttps://example.com/a,Launch,launch,facebook|line\nhttps://example.com/a,Again,launch,line|facebook\nftp://example.com,Bad,bad,line\n';
  const p=planCsvImport(csv);assert.equal(p.createsResources,false);assert.equal(p.dryRun,true);assert.deepEqual(p.rows.map(r=>r.valid),[true,false,false]);assert.match(p.rows[1].error,/Duplicate/);assert.throws(()=>planCsvImport('url,url\nx,y'));assert.throws(()=>planCsvImport('url,name,utmCampaign,channels\n'+Array(101).fill('https://example.com,a,a,line').join('\n')));
  const ids=planCsvImport(`url,name,utmCampaign,channels,requestId\nhttps://example.com/a,A,a,line,${draft.requestId}\nhttps://example.com/b,B,b,line,${draft.requestId}`);assert.equal(ids.rows[0].valid,true);assert.equal(ids.rows[1].valid,false);assert.match(ids.rows[1].error,/requestId/);
});
test("SDK uses the exact stable creation identity and never follows redirects or retries", async () => {
  const calls=[];const client=new LinkDeviClient({apiKey:"su_fixture",fetch:async(u,o)=>{calls.push({url:String(u),...o});return Response.json({campaign:{id:"kit"},reused:calls.length>1});}});
  await client.createCampaign(draft);await client.createCampaign(draft);assert.equal(calls.length,2);assert.equal(calls[0].url,"https://linkdevi.com/api/v1/agent");assert.equal(calls[0].redirect,"error");assert.equal(calls[0].headers.Authorization,"Bearer su_fixture");assert.equal(calls[0].body,calls[1].body);assert.equal(JSON.parse(calls[0].body).campaign.requestId,draft.requestId);
  let count=0;const broken=new LinkDeviClient({apiKey:"su_fixture",fetch:async()=>{count++;throw Error("su_fixture private-network-details");}});
  await assert.rejects(broken.createCampaign(draft),e=>e instanceof LinkDeviError && e.ambiguous && !e.message.includes("su_fixture"));assert.equal(count,1);
});
test("SDK retains HTTP status and retry delay while sanitizing untrusted error messages", async () => {
  const client=new LinkDeviClient({apiKey:"su_fixture",fetch:async()=>Response.json({error:"RATE_LIMIT_REACHED"},{status:429,headers:{"Retry-After":"12"}})});
  await assert.rejects(client.capabilities(),e=>e.status===429&&e.retryAfter===12&&e.code==="RATE_LIMIT_REACHED");
  const bad=new LinkDeviClient({apiKey:"su_fixture",fetch:async()=>new Response("unavailable",{status:503})});await assert.rejects(bad.createCampaign(draft),e=>e.code==="INVALID_RESPONSE"&&e.ambiguous&&e.status===503);
  for(const baseUrl of ["http://example.com","https://u:p@example.com","https://example.com/path","https://example.com/?key=x"])assert.throws(()=>new LinkDeviClient({apiKey:"su_fixture",baseUrl}));
});
test("CLI offline exports need no account and creation requires explicit review plus saved identity", () => {
  const dir=mkdtempSync(resolve(tmpdir(),"linkdevi-cli-"));
  try{
    const cli=new URL("../dist/cli.js",import.meta.url).pathname;
    const run=args=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:"utf8",env:{...process.env,LINKDEVI_API_KEY:"",LINKDEVI_BASE_URL:"http://127.0.0.1:1"},timeout:10000});
    assert.equal(run(["campaign","init","--out","campaign.json"]).status,0);const file=JSON.parse(readFileSync(resolve(dir,"campaign.json")));assert.ok(file.requestId);assert.equal(run(["campaign","init","--out","campaign.json"]).status,1);
    const p=run(["campaign","preview","campaign.json"]);assert.equal(p.status,0);assert.equal(JSON.parse(p.stdout).createsResources,false);assert.equal(run(["campaign","preview","campaign.json","--format","csv"]).stdout.startsWith("\uFEFF"),true);
    assert.equal(run(["campaign","create","campaign.json"]).status,1);assert.equal(run(["campaign","create","campaign.json","--confirm"]).status,1);
    writeFileSync(resolve(dir,"links.csv"),'url,name,utmCampaign,channels\nhttps://example.com,Launch,launch,line\n');const result=run(["links","import","links.csv","--dry-run"]);assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).dryRun,true);assert.equal(run(["links","import","links.csv"]).status,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
