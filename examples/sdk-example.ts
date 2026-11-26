import { LinkDeviClient, previewCampaign, type CampaignRequest } from "../dist/index.js";
// Save this intent's UUID and payload before creating. Keep both unchanged on retry.
const intent: CampaignRequest = {
  requestId: "a43c37c0-350a-44ef-9d40-a5900c246891",
  name: "December launch", url: "https://example.com/sale", utmCampaign: "december-launch",
  domain: "linkdevi.com", channels: ["facebook", "line", "print"],
};
console.log(previewCampaign(intent)); // Offline, no key and no quota.
// Opt in deliberately after reviewing the preview. No model is invoked.
if (process.env.LINKDEVI_CREATE === "1") {
  const client = new LinkDeviClient({ apiKey: process.env.LINKDEVI_API_KEY ?? "" });
  console.log(await client.createCampaign(intent));
}
