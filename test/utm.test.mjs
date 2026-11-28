import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintUtmUrls, lintUtmCsv, formatUtmReport, launchCsv } from "../dist/index.js";
const good = "https://example.com/launch?utm_source=facebook&utm_medium=social&utm_campaign=launch";
const codes = report => report.rows.flatMap(row => row.issues.map(i => i.code));

test("offline UTM checks detect missing, duplicated and incorrectly cased parameters", () => {
  assert.deepEqual(lintUtmUrls([good]).summary, { rows: 1, errors: 0, warnings: 0 });
  assert.ok(codes(lintUtmUrls(["https://example.com?utm_source=facebook"])).includes("MISSING_UTM_CAMPAIGN"));
  const r = lintUtmUrls([good + "&UTM_SOURCE=line"]);
  assert.ok(codes(r).includes("UTM_KEY_CASE"));
  assert.ok(codes(r).includes("DUPLICATE_UTM_PARAMETER"));
  assert.ok(codes(lintUtmUrls([good.replace("social", " ")])).includes("MISSING_UTM_MEDIUM"));
});
test("source consistency and duplicates preserve meaningful destination differences", () => {
  const reordered = "https://example.com/launch?utm_campaign=launch&utm_medium=social&utm_source=facebook";
  const r = lintUtmUrls([good, reordered, good.replace("facebook", "Facebook"), good + "&product=2"]);
  assert.ok(r.rows[1].issues.some(i => i.code === "DUPLICATE_URL"));
  assert.ok(r.rows[0].issues.some(i => i.code === "INCONSISTENT_SOURCE"));
  assert.ok(!r.rows[3].issues.some(i => i.code === "DUPLICATE_URL"));
});
test("CSV accepts launch exports, quoted records and bounded input", () => {
  const csv = launchCsv({name:"Launch",url:"https://example.com",utmCampaign:"launch",domain:"linkdevi.com",channels:["facebook","line"]});
  assert.equal(lintUtmCsv(csv).summary.errors, 0);
  assert.equal(lintUtmCsv('name,url\r\n"One, two","'+good+'"').rows[0].row, 2);
  assert.equal(lintUtmCsv('url,name\n'+good).summary.errors, 1);
  for (const raw of ['url,url\na,b','url,destination_url\na,b','url\n"unfinished']) assert.throws(() => lintUtmCsv(raw));
  assert.throws(() => lintUtmUrls(Array(101).fill(good)));
  assert.throws(() => lintUtmCsv('url\n'+Array(101).fill(good).join('\n')));
});
test("reports do not disclose destinations, credentials or annotation injection", () => {
  const privateUrl = 'https://user:PRIVATE@example.com/private?token=SECRET';
  const report = lintUtmUrls([privateUrl, good + '&utm_content=%0A%3A%3Aerror%3A%3AINJECT']);
  const serialized = JSON.stringify(report) + formatUtmReport(report, "github");
  for (const token of ['PRIVATE','SECRET','INJECT','/private']) assert.ok(!serialized.includes(token));
  assert.ok(codes(report).includes("INVALID_URL"));
  for (const url of ['file:///etc/passwd','ftp://example.com','https://example.com/\nprivate']) assert.equal(lintUtmUrls([url]).summary.errors,1);
});
test("CLI runs without credentials, supports CI annotations and warning failure thresholds", () => {
  const dir = mkdtempSync(join(tmpdir(), "linkdevi-utm-"));
  try {
    const file = join(dir, "links.csv"), cli = new URL("../dist/cli.js", import.meta.url).pathname;
    const run = extra => spawnSync(process.execPath,[cli,"utm","lint",file,...extra],{encoding:"utf8",env:{...process.env,LINKDEVI_API_KEY:"",LINKDEVI_BASE_URL:"http://127.0.0.1:1"},timeout:10000});
    writeFileSync(file,'url\n'+good+'\n'+good);
    assert.equal(run([]).status,0);
    assert.equal(run(["--strict"]).status,1);
    const json=run(["--format","json"]);assert.equal(JSON.parse(json.stdout).offline,true);
    assert.ok(run(["--format","github"]).stdout.includes("::warning::"));
    writeFileSync(file,'url\nhttps://example.com');assert.equal(run([]).status,1);
    assert.equal(run(["--format","csv"]).status,1);
    writeFileSync(file,"x".repeat(262145));assert.equal(run([]).status,1);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
