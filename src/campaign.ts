/** Offline-only helpers. No network, credentials, storage or model provider. */
export const campaignChannels = {
  facebook: { source: "facebook", medium: "social", label: "Facebook" },
  instagram: { source: "instagram", medium: "social", label: "Instagram" },
  tiktok: { source: "tiktok", medium: "social", label: "TikTok" },
  line: { source: "line", medium: "messaging", label: "LINE" },
  email: { source: "newsletter", medium: "email", label: "Email" },
  print: { source: "qr", medium: "offline", label: "QR / Print" },
  youtube: { source: "youtube", medium: "video", label: "YouTube" },
  x: { source: "x", medium: "social", label: "X" },
} as const;
export type CampaignChannel = keyof typeof campaignChannels;
export const channelKeys = Object.keys(campaignChannels) as CampaignChannel[];
export interface CampaignDraft {
  name: string; url: string; utmCampaign: string; domain: string; channels: CampaignChannel[];
}
export interface CampaignRequest extends CampaignDraft { requestId: string }
export const isRequestId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function normalizeUrl(value: string): string {
  const text = value.trim();
  if (!text || text.length > 2048) throw new Error("Enter a URL up to 2,048 characters.");
  if (text.includes("://") && !/^https?:\/\//i.test(text)) throw new Error("Use an http or https URL.");
  const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > 2048)
    throw new Error("Enter a valid http or https URL.");
  return url.href;
}
export function campaignSlug(name: string) {
  return name.normalize("NFKC").toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}
export function campaignDestination(url: string, campaign: string, channel: CampaignChannel) {
  const destination = new URL(url);
  for (const key of [...destination.searchParams.keys()]) if (/^utm_/i.test(key)) destination.searchParams.delete(key);
  destination.searchParams.set("utm_source", campaignChannels[channel].source);
  destination.searchParams.set("utm_medium", campaignChannels[channel].medium);
  destination.searchParams.set("utm_campaign", campaign);
  return destination.href;
}
function text(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid ${field}`);
  return value.trim();
}
export function validateCampaign(value: unknown, requireIdentity = false): CampaignDraft & { requestId?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid campaign");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["requestId", "name", "url", "utmCampaign", "domain", "channels"].includes(key))) throw new Error("Unknown campaign field");
  const name = text(input.name, "name"), utmCampaign = text(input.utmCampaign, "utmCampaign");
  if (typeof input.url !== "string") throw new Error("Invalid URL");
  const url = normalizeUrl(input.url);
  const domain = input.domain ?? "linkdevi.com";
  // Public preview never claims that a domain is available to the account.
  if (typeof domain !== "string" || domain.length > 253 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/i.test(domain)) throw new Error("Invalid domain");
  if (!Array.isArray(input.channels) || input.channels.length < 1 || input.channels.length > 8 || new Set(input.channels).size !== input.channels.length || input.channels.some(key => !channelKeys.includes(key as CampaignChannel))) throw new Error("Select 1–8 distinct supported channels");
  const channels = input.channels as CampaignChannel[];
  if (channels.some(key => campaignDestination(url, utmCampaign, key).length > 2048)) throw new Error("Tagged URL exceeds 2048 characters");
  if ((requireIdentity || input.requestId !== undefined) && !isRequestId(input.requestId)) throw new Error("Provide a stable UUID requestId; preserve it and the exact payload on retry");
  return { name, url, utmCampaign, domain, channels: [...channels], ...(input.requestId ? { requestId: String(input.requestId).toLowerCase() } : {}) };
}
export function previewCampaign(value: unknown) {
  const draft = validateCampaign(value);
  return {
    ...(draft.requestId ? { requestId: draft.requestId } : {}),
    linksToCreate: draft.channels.length,
    channels: draft.channels.map(channel => ({ channel, destinationUrl: campaignDestination(draft.url, draft.utmCampaign, channel) })),
    createsResources: false as const,
  };
}
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function launchCsv(value: unknown): string {
  const draft = validateCampaign(value), preview = previewCampaign(draft);
  return "\uFEFF" + [
    ["campaign", "channel", "utm_source", "utm_medium", "utm_campaign", "destination_url", "status"],
    ...preview.channels.map(row => [draft.name, row.channel, campaignChannels[row.channel].source, campaignChannels[row.channel].medium, draft.utmCampaign, row.destinationUrl, "preview_only"]),
  ].map(row => row.map(csvCell).join(",")).join("\r\n");
}
export function parseCsv(raw: string): string[][] {
  if (new TextEncoder().encode(raw).byteLength > 262144) throw new Error("CSV exceeds 256 KiB");
  const input = raw.replace(/^\uFEFF/, ""), rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const flushCell = () => { row.push(cell); cell = ""; closed = false; };
  const flushRow = () => { flushCell(); if (row.some(Boolean)) rows.push(row); row = []; if (rows.length > 101) throw new Error("Maximum 100 data rows"); };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === '"') {
      if (cell || closed) throw new Error("Invalid CSV quoting");
      quoted = true;
    } else if (ch === ",") flushCell();
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && input[i + 1] === "\n") i++; flushRow(); }
    else { if (closed) throw new Error("Unexpected character after CSV quote"); cell += ch; }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (cell || row.length || closed) flushRow();
  return rows;
}
export function planCsvImport(raw: string) {
  const [headers, ...rows] = parseCsv(raw);
  if (!headers || new Set(headers).size !== headers.length || !["url", "name", "utmCampaign", "channels"].every(key => headers.includes(key))) throw new Error("CSV requires unique headers: url,name,utmCampaign,channels; optional domain,requestId");
  if (headers.some(key => !["url", "name", "utmCampaign", "channels", "domain", "requestId"].includes(key)) || !rows.length) throw new Error("CSV has unknown columns or no data rows");
  const seen = new Set<string>(), requestIds = new Set<string>();
  return { dryRun: true as const, createsResources: false as const, rows: rows.map((row, index) => {
    try {
      if (row.length !== headers.length) throw new Error("Column count mismatch");
      const values = Object.fromEntries(headers.map((key, i) => [key, row[i]]));
      const draft = validateCampaign({ ...values, domain: values.domain || "linkdevi.com", channels: values.channels.split("|").map(c => c.trim()), ...(values.requestId ? {} : { requestId: undefined }) });
      const identity = JSON.stringify([draft.url, draft.utmCampaign, [...draft.channels].sort()]);
      if (seen.has(identity)) throw new Error("Duplicate campaign row");
      if (draft.requestId && requestIds.has(draft.requestId)) throw new Error("Duplicate requestId across rows");
      seen.add(identity);
      if (draft.requestId) requestIds.add(draft.requestId);
      return { row: index + 2, valid: true as const, campaign: draft, preview: previewCampaign(draft) };
    } catch (error) { return { row: index + 2, valid: false as const, error: (error as Error).message }; }
  }) };
}
