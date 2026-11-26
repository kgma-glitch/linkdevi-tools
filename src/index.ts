export * from "./campaign.js";
import { validateCampaign, type CampaignRequest, type CampaignChannel } from "./campaign.js";
export interface CampaignView {
  id: string; name: string; url: string; utmCampaign: string; domain: string;
  channels: { key: CampaignChannel; link: null | { id: string; shortUrl: string; url: string; clicks: number; active: boolean } }[];
}
export interface CampaignResult { campaign: CampaignView; reused: boolean; managePath?: string }
export interface Capabilities { workspaceId: string; scopes: string[]; plan: string; limits: Record<string, unknown>; usage: { storedLinks: number }; counterDefinition: Record<string, unknown> }
export class LinkDeviError extends Error {
  constructor(public status: number, public code: string, public retryAfter: number | null = null, public ambiguous = false) {
    super(ambiguous ? "Response unavailable; creation may have committed. Reuse the original requestId and exact payload." : `LinkDevi request failed (HTTP ${status || "unavailable"}).`);
    this.name = "LinkDeviError";
  }
}
export class LinkDeviClient {
  private origin: URL;
  private apiKey: string;
  private fetchImpl: typeof fetch;
  constructor(options: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }) {
    this.origin = new URL(options.baseUrl ?? "https://linkdevi.com");
    const u = this.origin;
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/" || !(u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))) throw new Error("Use an HTTPS service origin, or localhost HTTP for testing");
    if (!/^su_[a-zA-Z0-9]+$/.test(options.apiKey ?? "")) throw new Error("A scoped LinkDevi API key is required");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }
  private async call<T>(action: string, args: Record<string, unknown> = {}, mutates = false): Promise<T> {
    let response: Response;
    try { response = await this.fetchImpl(new URL("/api/v1/agent", this.origin), { method: "POST", redirect: "error", signal: AbortSignal.timeout(25000), headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...args }) }); }
    catch { throw new LinkDeviError(0, "NETWORK_UNAVAILABLE", null, mutates); }
    let data: unknown;
    try { data = await response.json(); } catch { throw new LinkDeviError(response.status, "INVALID_RESPONSE", null, mutates); }
    if (!response.ok) {
      const retry = response.headers.get("retry-after"), seconds = retry ? Number(retry) : NaN;
      const rawCode = data && typeof data === "object" && "error" in data ? String(data.error) : "HTTP_ERROR";
      const code = /^[a-zA-Z_]{1,64}$/.test(rawCode) && !rawCode.includes(this.apiKey) ? rawCode : "HTTP_ERROR";
      throw new LinkDeviError(response.status, code, Number.isFinite(seconds) && seconds >= 0 ? seconds : null);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new LinkDeviError(response.status, "INVALID_RESPONSE", null, mutates);
    return data as T;
  }
  capabilities() { return this.call<Capabilities>("capabilities"); }
  previewCampaign(campaign: CampaignRequest) { return this.call<ReturnType<typeof import("./campaign.js").previewCampaign>>("preview_campaign", { campaign: validateCampaign(campaign, true) }); }
  createCampaign(campaign: CampaignRequest) { return this.call<CampaignResult>("create_campaign", { campaign: validateCampaign(campaign, true) }, true); }
  listCampaigns(page = 1) {
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw new Error("Invalid page");
    return this.call<{ items: CampaignView[]; total: number; page: number; pageSize: number }>("list_campaigns", { page });
  }
  campaignStats(campaignId: string) { return this.call<{ campaign: CampaignView; observedAt: string; counterDefinition: Record<string, unknown>; unavailableChannels: CampaignChannel[] }>("campaign_stats", { campaignId: this.id(campaignId) }); }
  linkQr(linkId: string, size = 300) {
    if (!Number.isInteger(size) || size < 100 || size > 512) throw new Error("Size must be 100–512");
    return this.call<{ linkId: string; shortUrl: string; qrDataUrl: string; persistsResource: false }>("link_qr", { linkId: this.id(linkId), size });
  }
  private id(value: string) { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error("Invalid resource ID"); return value; }
}
