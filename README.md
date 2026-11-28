# LinkDevi developer pack

Documentation: [Quickstart](https://linkdevi.com/docs/quickstart) · [CLI](https://linkdevi.com/docs/cli) · [TypeScript SDK](https://linkdevi.com/docs/sdk) · [n8n setup](https://linkdevi.com/docs/n8n) · [AI-readable index](https://linkdevi.com/llms.txt).

Offline Campaign Launch Kit helpers, a TypeScript SDK, a Node.js CLI and three n8n workflows. MIT licensed. Node.js 22+.

Package name: `@kgma/linkdevi-tools`. The separately distributed `@kgma/linkdevi-mcp` is the MCP connector. This repository includes the complete source and build instructions; npm releases and source releases carry their own version.

```sh
npm install @kgma/linkdevi-tools@0.2.0
npx --no-install linkdevi --help
```

Source: [kgma-glitch/linkdevi-tools](https://github.com/kgma-glitch/linkdevi-tools). Use the source or local tarball instructions below when working before a registry release is available.

## Start without an account

```sh
npm ci
npm run build
node dist/cli.js campaign init --out campaign.json
node dist/cli.js campaign preview campaign.json
node dist/cli.js campaign preview campaign.json --format csv > launch.csv
node dist/cli.js links import examples/links.csv --dry-run
```

Preview, UTM generation, CSV export and CSV preflight run locally, without a key, network request or model. The CSV import command is deliberately a **dry run only**; it does not create links. It accepts at most 100 rows and a 256 KiB file, with columns `url,name,utmCampaign,channels` and optional `domain,requestId`. Separate channels using `|`. CSV exports label destinations as `preview_only`, retain non-UTM query values and fragments, replace old UTM values, and neutralize spreadsheet formulas in text cells.

The public website uses the same channel/UTM helpers at `/tools/campaign-launch-kit` and `/th/campaign-launch-kit` (also Chinese, Spanish, Indonesian and Japanese). Preview does not reserve quota. A domain in an offline preview does not prove that the account can use it; the service validates that when saving.

## UTM Checker / Linter (0.2.0)

Version `0.2.0` includes `utm lint`; version `0.1.0` does not. Build this checkout or install the versioned package when available on the registry. The check runs offline, requires no account or API key, does not open destination URLs, and creates no links.

```sh
npm ci
npm run build
node dist/cli.js utm lint examples/utm-links.csv
node dist/cli.js utm lint examples/utm-links.csv --format json
node dist/cli.js utm lint examples/utm-links.csv --format github --strict
# Check the destinations exported by campaign preview:
node dist/cli.js campaign preview campaign.json --format csv > launch.csv
node dist/cli.js utm lint launch.csv
```

Accepts CSV with one `url` or `destination_url` column (unique headers, up to 100 data records and 256 KiB). Other columns are retained in your original file and are not included in the report. Records must have the same column count as the header. Record numbers are logical CSV records, including the header; quoted multiline fields do not correspond to physical line numbers.

Errors cover invalid URLs, missing/blank `utm_source`, `utm_medium` or `utm_campaign`, duplicate UTM parameters including case variants, and decoded control characters. Warnings cover parameter casing, unknown UTM keys, whitespace, source capitalization variants across rows, and repeated URLs ignoring query parameter order. Different non-UTM destination parameters or fragments remain distinct. Naming conventions vary: review warnings deliberately; the tool does not rewrite files, merge source names, check destination availability, or promise analytics attribution.

Exit status is `1` for errors or malformed input, `0` for a clean check or warnings only. Add `--strict` to fail on warnings too. JSON has `schemaVersion: 1`, row-level issue codes, and totals. Reports omit destination URLs and parameter values, including GitHub annotations. Keep input files private when needed.

The SDK exports `lintUtmUrls`, `lintUtmCsv` and `formatUtmReport`. Use [the workflow example](examples/github-actions/utm-lint.yml) in a source checkout; it needs only read access and no secrets. The repository CI workflow tests Node 22 and 24, checks the sample CSV and installs the packed CLI in a clean consumer. Check the Actions tab for the result on the exact commit you use. Action references follow the official [checkout](https://github.com/actions/checkout) and [setup-node](https://github.com/actions/setup-node) examples and are pinned to the reviewed commits.

After reviewing a report, use [Campaign Launch Kit](https://linkdevi.com/tools/campaign-launch-kit?utm_source=github&utm_medium=developer_tool&utm_campaign=utm_linter) to prepare channel links. Preview/export is free without signing in. Saving short links requires a LinkDevi account and uses your workspace permissions and allowance. Keep your existing URL/UTM decisions when preparing a new campaign; linting does not automatically import or save them.

## Create and manage saved campaigns

1. Create a [LinkDevi account](https://linkdevi.com/register), open Connect AI, and create a scoped key. Use `links:read` and `links:write` for campaign creation, or only `links:read` for read-only use.
2. Supply `LINKDEVI_API_KEY` through your shell's protected environment or secret manager. The optional `LINKDEVI_BASE_URL` defaults to `https://linkdevi.com`; only HTTPS origins are accepted except localhost HTTP for development.
3. Edit the generated `campaign.json`, inspect the preview, then deliberately create:

```sh
node dist/cli.js capabilities
node dist/cli.js campaign create campaign.json --confirm
node dist/cli.js campaign list --page 1
node dist/cli.js campaign stats CAMPAIGN_ID
```

`campaign init --out` refuses to overwrite an existing file. Keep the UUID `requestId` and exact payload in that file. A timeout or invalid response may mean creation committed. Retry **only with the original identity and unchanged payload**; do not re-run init to retry. Changed payloads using the same UUID conflict. There are no automatic retries. HTTP 429 retains its numeric `Retry-After` in SDK/CLI errors. Wait before retrying. Never put a real key in arguments, a repository, an issue or a prompt.

Each selected channel uses one stored-link slot. Hosted LinkDevi account limits, shared workspace RPM and permissions apply. The package does not include a shortening backend, model subscription or hosted OAuth MCP endpoint. It does not invoke an LLM. For printed QR codes, save the short link first and render that saved link's QR, so its destination can later be edited in the account.

## TypeScript SDK

Build the source, then import from `./dist/index.js` (the package root exports the same API after local installation). See `examples/sdk-example.ts` for a typed, opt-in example.

```ts
import { LinkDeviClient, previewCampaign, type CampaignRequest } from './dist/index.js';

const intent: CampaignRequest = {
  requestId: 'a43c37c0-350a-44ef-9d40-a5900c246891',
  name: 'December launch', url: 'https://example.com/sale',
  utmCampaign: 'december-launch', domain: 'linkdevi.com',
  channels: ['facebook', 'line', 'print'],
};
console.log(previewCampaign(intent)); // local, no quota

// Call deliberately after review; store this intent before sending it.
const client = new LinkDeviClient({ apiKey: process.env.LINKDEVI_API_KEY! });
const saved = await client.createCampaign(intent);
console.log(saved.campaign.id);
```

The client exposes `capabilities`, `previewCampaign` (authenticated service preview), `createCampaign`, `listCampaigns`, `campaignStats`, and `linkQr`. The root `previewCampaign` helper is the offline alternative. SDK credentials belong in a server, local process, or protected client environment, not a publicly shipped browser bundle. Redirects are rejected and raw network failures are not printed.

Reports are best-effort lifetime redirect counters including bots/previews. They do not measure unique people, dated activity, conversions or revenue. A missing channel is unavailable. `linkQr` renders a PNG for an existing saved link and does not persist a separate QR record.

## n8n workflow pack

Import the JSON files under `workflows/`. They use built-in nodes, are inactive, and start with a manual trigger. Read each workflow's sticky note before running.

| File | Input and output |
| --- | --- |
| `01-google-sheets-to-links.json` | Read campaign rows, create saved campaigns, update the same sheet by its unique pre-saved `requestId` |
| `02-campaign-to-csv.json` | Campaign brief → saved campaign links → downloadable CSV |
| `03-rss-to-share-kit.json` | Up to five RSS articles → deterministic identities → saved share kits → CSV; no social posting |

Configure Header Auth in the HTTP node: name `Authorization`, value `Bearer YOUR_SCOPED_KEY`. Select the credential inside n8n; the exported workflow contains no key. Google Sheets also needs your own Google credential and spreadsheet ID in both Sheets nodes. Create columns `requestId,name,url,utmCampaign,channels,domain,shortUrls,campaignId`; save a unique UUID in every source row before running. Completed rows with `shortUrls` are skipped. Use `RAW` when writing values.

If you do not have n8n connected to Google yet, import the workflow first and leave it inactive. In each Google Sheets node, select **Create new credential**, complete n8n's Google OAuth setup for your hosting option, and authorize your Google account yourself. Select the same credential and a dedicated test spreadsheet in both nodes. Start with one test campaign row, manually execute, and verify that `shortUrls` and `campaignId` are written back to that row. Execute again to check that the completed row is skipped. Do not enable a schedule before this check. The fixture tests do not verify your Google account or permissions. Follow the [official Google Sheets credential guide](https://docs.n8n.io/integrations/builtin/credentials/google/).

For RSS, set the actual feed URL and a stable, unique feed namespace in Prepare article identities. Keep the namespace, article content and campaign fields unchanged on retry. Edited payloads for the same article identity conflict and need review. Replays still consume API requests. HTTP nodes disable redirects and retries and pace batches at 2.5 seconds per item; shared limits can still return 429 and stop execution. These are creation workflows, not offline previews. They send data to LinkDevi only when manually run with configured credentials. They do not schedule, post or send messages.

Reference: [n8n HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/), [Google Sheets](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/sheet-operations/).

## Local installation and verification

```sh
npm test
npm pack
# In another project, install the generated local artifact:
npm install /absolute/path/to/kgma-linkdevi-tools-0.2.0.tgz
npx --no-install linkdevi --help
```

The package includes compiled JavaScript, TypeScript declarations, examples, workflows, README and license. Tests, local environments, npm credentials and infrastructure are excluded. Source tests exercise URL semantics, CSV injection/quoting/bounds, retry identity, transport restrictions and CLI behavior. Real account/provider checks must be distinguished from fixture tests; no real demand or conversion outcome is inferred from passing tests.
