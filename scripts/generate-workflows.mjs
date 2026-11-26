import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const target = fileURLToPath(new URL("../workflows/", import.meta.url));
mkdirSync(target,{recursive:true});
const node=(name,type,parameters={},x=0,y=0,typeVersion=1)=>({id:name.toLowerCase().replaceAll(/[^a-z0-9]+/g,"-"),name,type:`n8n-nodes-base.${type}`,typeVersion,position:[x,y],parameters});
const manual=()=>node("Run manually","manualTrigger");
const code=(name,jsCode,x,y=0)=>node(name,"code",{mode:"runOnceForAllItems",jsCode},x,y,2);
const http=(x)=>({...node("Create saved campaign","httpRequest",{
  method:"POST",url:"https://linkdevi.com/api/v1/agent",authentication:"genericCredentialType",genericAuthType:"httpHeaderAuth",
  sendBody:true,specifyBody:"json",jsonBody:"={{ { action: 'create_campaign', campaign: $json.campaign } }}",
  options:{timeout:25000,redirect:{redirect:{followRedirects:false}},batching:{batch:{batchSize:1,batchInterval:2500}}},
},x,0,4.3),retryOnFail:false,onError:"stopWorkflow"});
const note=(content)=>node("Read before running","stickyNote",{content,width:700,height:360},0,-430);
const common=`## Setup\n1. Create a LinkDevi account, then a scoped key with links:read and links:write. Hosted plan limits apply.\n2. In Create saved campaign, select a Header Auth credential: header name Authorization, value Bearer YOUR_SCOPED_KEY. Keep the key only in n8n Credentials.\n3. Keep retries disabled. Redirects are disabled so credentials stay on the configured origin.\n4. Preview your data before running. Each selected channel uses one stored-link slot. A timeout may have committed: preserve requestId and the exact campaign payload on retry.\n5. These workflows do not call an LLM, send email, post to social media or enable a schedule. Activate only after reviewing your own setup.\nGuide: https://linkdevi.com/features/ai`;
const flatten=`const safe = value => { const s=String(value ?? ''); return /^[\\s\\u0000-\\u001f]*[=+@-]/.test(s) ? "'"+s : s; };
return $input.all().flatMap((item,index)=>{
 const c=item.json.campaign;
 if(!c || !Array.isArray(c.channels)) throw new Error('Missing saved campaign response');
 return c.channels.map(row=>({json:{campaign:safe(c.name),channel:row.key,short_url:row.link?.shortUrl ?? '',destination_url:row.link?.url ?? '',status:row.link?'saved':'unavailable'},pairedItem:{item:index}}));
});`;
const csv=x=>node("Download CSV","convertToFile",{operation:"csv",binaryPropertyName:"data",options:{fileName:"linkdevi-campaign-links.csv",headerRow:true}},x,0,1.1);
function save(file,name,nodes,steps){
 const connections={};for(let i=0;i<steps.length-1;i++) connections[steps[i]]={main:[[{node:steps[i+1],type:"main",index:0}]]};
 writeFileSync(target+file,JSON.stringify({name,nodes,connections,active:false,settings:{executionOrder:"v1"},pinData:{},tags:[]},null,2)+'\n');
}
const prepareSheets=`const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed=['facebook','instagram','tiktok','line','email','print','youtube','x'];
const input=$input.all(); if(input.length>100) throw new Error('Read at most 100 sheet rows per run');
const used=new Set();
return input.flatMap((item,index)=>{
 const r=item.json; if(r.shortUrls) return [];
 if(!uuid.test(String(r.requestId)) || used.has(r.requestId)) throw new Error('Each row needs its own UUID requestId, saved in the sheet before running');
 used.add(r.requestId);
 const channels=String(r.channels??'').split('|').map(x=>x.trim());
 if(!channels.length || new Set(channels).size!==channels.length || channels.some(c=>!allowed.includes(c))) throw new Error('Invalid channels');
 if(!r.name || !r.utmCampaign || !/^https?:\\/\\//i.test(String(r.url)) || /^https?:\\/\\/[^/]*@/i.test(String(r.url))) throw new Error('Provide name, URL and utmCampaign');
 return [{json:{requestId:r.requestId,campaign:{requestId:r.requestId,name:String(r.name),url:String(r.url),utmCampaign:String(r.utmCampaign),domain:String(r.domain||'linkdevi.com'),channels}},pairedItem:{item:index}}];
});`;
const sheetRead=node("Read campaign rows","googleSheets",{operation:"read",documentId:{__rl:true,value:"REPLACE_WITH_SPREADSHEET_ID",mode:"id"},sheetName:{__rl:true,value:"Campaigns",mode:"name"},options:{}},250,0,4.7);
const sheetUpdate=node("Write links to sheet","googleSheets",{operation:"update",documentId:{__rl:true,value:"REPLACE_WITH_SPREADSHEET_ID",mode:"id"},sheetName:{__rl:true,value:"Campaigns",mode:"name"},columns:{mappingMode:"defineBelow",value:{requestId:"={{ $('Prepare campaign rows').item.json.requestId }}",shortUrls:"={{ $json.campaign.channels.map(c => c.link?.shortUrl || '').filter(Boolean).join(' | ') }}",campaignId:"={{ $json.campaign.id }}"},matchingColumns:["requestId"],schema:[{id:"requestId",displayName:"requestId",type:"string",canBeUsedToMatch:true},{id:"shortUrls",displayName:"shortUrls",type:"string"},{id:"campaignId",displayName:"campaignId",type:"string"}]},options:{cellFormat:"RAW"}},1000,0,4.7);
save("01-google-sheets-to-links.json","LinkDevi — Google Sheets to saved campaign links",[
 manual(),sheetRead,code("Prepare campaign rows",prepareSheets,500),http(750),sheetUpdate,
 note(common+`\n\n## Sheet columns\nrequestId, name, url, utmCampaign, channels, domain, shortUrls, campaignId\nUse one UNIQUE, pre-saved UUID per row. channels uses |, e.g. facebook|line|print. Rows with shortUrls are skipped. Configure the same spreadsheet in both Sheets nodes and select your Google Sheets credential. Output matching uses requestId, not a changing row position. Limit input to 100 rows; 429 stops the workflow. Review your data and credentials before running.`),
],["Run manually","Read campaign rows","Prepare campaign rows","Create saved campaign","Write links to sheet"]);
const sample=`return [{json:{campaign:{requestId:'a43c37c0-350a-44ef-9d40-a5900c246891',name:'December launch',url:'https://example.com/sale',utmCampaign:'december-launch',domain:'linkdevi.com',channels:['facebook','line','print']}}}];`;
save("02-campaign-to-csv.json","LinkDevi — Campaign brief to saved links and CSV",[
 manual(),code("Campaign brief",sample,250),http(500),code("CSV rows",flatten,750),csv(1000),
 note(common+`\n\n## Campaign brief\nReplace the example destination and names with your own. Use a NEW UUID for each NEW campaign. Keep the same UUID and unchanged fields after a timeout. This workflow creates one campaign when manually executed; it is not an offline preview. Download the binary data from Download CSV. Existing UTM values are replaced by the campaign service.`),
],["Run manually","Campaign brief","Create saved campaign","CSV rows","Download CSV"]);
const rss=node("Read RSS","rssFeedRead",{url:"https://example.com/feed.xml",options:{}},250,0,1.1);
const rssSources=`return $input.all().slice(0,5).map((item,index)=>{
 const r=item.json; const url=String(r.link??'');
 if(!/^https?:\\/\\//i.test(url) || /^https?:\\/\\/[^/]*@/i.test(url)) throw new Error('RSS item needs an http(s) URL without credentials');
 const guid=String(r.guid??r.id??url); if(!guid.trim()) throw new Error('Missing article identity');
 // Include the feed namespace to avoid unrelated feeds sharing a GUID.
 const feedNamespace='REPLACE_WITH_YOUR_FEED_NAMESPACE';
 const name=('Post: '+String(r.title??'Article')).replace(/[\\u0000-\\u001f\\u007f]/g,' ').slice(0,100);
 return {json:{identity:feedNamespace+'\\n'+guid,name,url},pairedItem:{item:index}};
});`;
const hash=node("Hash article identity","crypto",{action:"hash",type:"SHA256",value:"={{ $json.identity }}",dataPropertyName:"digest",encoding:"hex"},500,0,1);
const rssCampaign=`return $input.all().map((item,index)=>{
 const h=String(item.json.digest); if(!/^[a-f0-9]{64}$/i.test(h)) throw new Error('Expected SHA256 article identity');
 const requestId=h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
 return {json:{campaign:{requestId,name:item.json.name,url:item.json.url,utmCampaign:'article-share',domain:'linkdevi.com',channels:['facebook','line','email']}},pairedItem:{item:index}};
});`;
save("03-rss-to-share-kit.json","LinkDevi — RSS articles to saved campaign share kits",[
 manual(),rss,code("Prepare article identities",rssSources,500),{...hash,position:[750,0]},code("Prepare article campaigns",rssCampaign,1000),http(1250),code("CSV rows",flatten,1500),csv(1750),
 note(common+`\n\n## RSS setup\nSet your actual feed URL and replace feedNamespace in Prepare article identities with a stable unique value for that feed. Process at most five entries per manual run. IDs are deterministically derived using the built-in Crypto node, so unchanged articles replay safely. Keep the namespace, title, destination and campaign settings stable across retries. An edited title/destination with the same identity conflicts: review it before intentionally starting a new intent. Repeat runs still use API requests even when no extra links are created. No social post is sent.`),
],["Run manually","Read RSS","Prepare article identities","Hash article identity","Prepare article campaigns","Create saved campaign","CSV rows","Download CSV"]);
console.log("Generated three inactive workflows; configure credentials and inputs before use.");
