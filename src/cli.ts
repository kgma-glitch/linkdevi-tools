#!/usr/bin/env node
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { LinkDeviClient, LinkDeviError } from "./index.js";
import { previewCampaign, validateCampaign, launchCsv, planCsvImport, type CampaignRequest } from "./campaign.js";
import { lintUtmCsv, formatUtmReport } from "./utm.js";
const help = `LinkDevi tools — Node 22+

  linkdevi campaign init [--out campaign.json]
  linkdevi campaign preview campaign.json [--format json|csv]
  linkdevi campaign create campaign.json --confirm
  linkdevi campaign list [--page 1]
  linkdevi campaign stats CAMPAIGN_ID
  linkdevi links import links.csv --dry-run
  linkdevi utm lint links.csv [--format json|text|github] [--strict]
  linkdevi capabilities

Preview, CSV validation and init work offline without an account.
Remote operations need LINKDEVI_API_KEY; optional LINKDEVI_BASE_URL defaults to https://linkdevi.com.
Create needs a UUID saved in the input file. Preserve that file unchanged after a timeout.
CSV import is a preflight only; no bulk write is performed.
Setup: https://linkdevi.com/features/ai`;
function read(path: string | undefined) {
  if (!path || path.startsWith("--")) throw new Error("Provide an input file");
  const info = statSync(path);
  if (!info.isFile() || info.size > 262144) throw new Error("Use a regular input file up to 256 KiB");
  const value = readFileSync(path, "utf8");
  if (Buffer.byteLength(value) > 262144) throw new Error("Input exceeds 256 KiB");
  return value;
}
function options(args: string[], allowed: Record<string, "value" | "flag">) {
  const values: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; if (!(key in allowed) || key in values) throw new Error("Unsupported or repeated argument; use --help");
    if (allowed[key] === "value") { const value = args[++i]; if (!value || value.startsWith("--")) throw new Error("Missing option value"); values[key] = value; }
    else values[key] = true;
  }
  return values;
}
async function main(args: string[]) {
  if (!args.length || (args.length === 1 && ["--help", "-h"].includes(args[0]))) { console.log(help); return; }
  if (args.length === 1 && args[0] === "--version") { console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version); return; }
  const [group, command, input, ...extra] = args;
  if (group === "utm" && command === "lint") {
    const opts = options(extra, { "--format": "value", "--strict": "flag" });
    const format = String(opts["--format"] || "text");
    if (!["json", "text", "github"].includes(format)) throw new Error("Unknown report format");
    const report = lintUtmCsv(read(input));
    process.stdout.write(format === "json" ? JSON.stringify(report, null, 2) + "\n" : formatUtmReport(report, format as "text" | "github"));
    if (report.summary.errors || (opts["--strict"] && report.summary.warnings)) process.exitCode = 1;
    return;
  }
  if (group === "campaign" && command === "init") {
    const opts = options(args.slice(2), { "--out": "value" });
    const draft = { requestId: randomUUID(), name: "December launch", url: "https://example.com/sale", utmCampaign: "december-launch", domain: "linkdevi.com", channels: ["facebook", "line", "print"] };
    const output = JSON.stringify(draft, null, 2) + "\n";
    if (opts["--out"]) writeFileSync(String(opts["--out"]), output, { flag: "wx", mode: 0o600 }); else process.stdout.write(output);
    return;
  }
  if (group === "campaign" && command === "preview") {
    const opts = options(extra, { "--format": "value" });
    if (opts["--format"] && !["json", "csv"].includes(String(opts["--format"]))) throw new Error("Format must be json or csv");
    const draft = JSON.parse(read(input));
    process.stdout.write(opts["--format"] === "csv" ? launchCsv(draft) + "\n" : JSON.stringify(previewCampaign(draft), null, 2) + "\n"); return;
  }
  if (group === "links" && command === "import") {
    const opts = options(extra, { "--dry-run": "flag" });
    if (!opts["--dry-run"]) throw new Error("CSV import currently requires --dry-run");
    const plan = planCsvImport(read(input)); console.log(JSON.stringify(plan, null, 2));
    if (plan.rows.some(row => !row.valid)) process.exitCode = 1;
    return;
  }
  // Reject malformed commands before constructing a client or sending a request.
  if (group === "campaign" && command === "create") { const opts = options(extra, { "--confirm": "flag" }); if (!opts["--confirm"]) throw new Error("Review the preview and add --confirm to create links"); }
  else if (group === "campaign" && command === "list") options(args.slice(2), { "--page": "value" });
  else if (group === "campaign" && command === "stats") { options(extra, {}); if (!input) throw new Error("Provide a campaign ID"); }
  else if (group === "capabilities") options(args.slice(1), {});
  else throw new Error("Unknown command; use --help");
  const client = new LinkDeviClient({ apiKey: process.env.LINKDEVI_API_KEY ?? "", baseUrl: process.env.LINKDEVI_BASE_URL });
  let result: unknown;
  if (group === "capabilities") result = await client.capabilities();
  else if (command === "create") result = await client.createCampaign(validateCampaign(JSON.parse(read(input)), true) as CampaignRequest);
  else if (command === "list") result = await client.listCampaigns(Number(options(args.slice(2), { "--page": "value" })["--page"] ?? 1));
  else result = await client.campaignStats(input);
  console.log(JSON.stringify(result, null, 2));
}
try { await main(process.argv.slice(2)); }
catch (error) {
  // Never print raw fs/network/parser errors: they may include private paths or inputs.
  if (error instanceof LinkDeviError) console.error(JSON.stringify({ error: error.code, status: error.status, retryAfter: error.retryAfter, ambiguous: error.ambiguous, message: error.message }));
  else console.error("Command failed. Check input, options and credentials. Use --help; no automatic retry was performed.");
  process.exitCode = 1;
}
