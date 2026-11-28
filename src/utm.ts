import { parseCsv } from "./campaign.js";

export interface UtmIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}
export interface UtmLintReport {
  schemaVersion: 1;
  offline: true;
  createsResources: false;
  summary: { rows: number; errors: number; warnings: number };
  rows: { row: number; issues: UtmIssue[] }[];
}
const required = ["utm_source", "utm_medium", "utm_campaign"];
const known = new Set([...required, "utm_content", "utm_term", "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic"]);

/** Checks local inputs only. Reports intentionally omit destinations and parameter values. */
export function lintUtmUrls(inputs: string[]): UtmLintReport {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100) throw new Error("Provide 1–100 URLs");
  const seen = new Map<string, number>();
  const sources = new Map<string, Map<string, number[]>>();
  const rows = inputs.map((raw, index) => {
    const issues: UtmIssue[] = [];
    const add = (code: string, severity: UtmIssue["severity"], message: string) => issues.push({ code, severity, message });
    let url: URL;
    try {
      if (typeof raw !== "string" || !raw || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error();
      url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch {
      add("INVALID_URL", "error", "Use an absolute HTTP(S) URL without credentials or control characters (maximum 2,048 characters).");
      return { row: index + 1, issues };
    }
    const params = new Map<string, string[]>();
    for (const [key, value] of url.searchParams) {
      const lower = key.toLowerCase();
      if (!lower.startsWith("utm_")) continue;
      params.set(lower, [...(params.get(lower) || []), value]);
      if (key !== lower) add("UTM_KEY_CASE", "warning", "Use lowercase UTM parameter names consistently.");
      if (!known.has(lower)) add("UNKNOWN_UTM_PARAMETER", "warning", "An unrecognized UTM parameter may not be used by your analytics setup.");
      if (/[\u0000-\u001f\u007f]/.test(value)) add("UTM_CONTROL_CHARACTER", "error", "A decoded UTM value contains a control character. Remove it before sharing.");
      if (value !== value.trim() || /\s/.test(value)) add("UTM_WHITESPACE", "warning", "A UTM value contains whitespace; review naming consistency.");
    }
    for (const key of required) {
      if (!params.get(key)?.some(v => v.trim())) add("MISSING_" + key.toUpperCase(), "error", key + " is required and must not be blank.");
    }
    for (const values of params.values()) {
      if (values.length > 1) add("DUPLICATE_UTM_PARAMETER", "error", "A UTM parameter appears more than once, including case variants. Choose one value deliberately.");
    }
    const source = params.get("utm_source");
    if (source?.length === 1 && source[0].trim()) {
      const group = source[0].trim().toLowerCase();
      const variants = sources.get(group) || new Map<string, number[]>();
      variants.set(source[0], [...(variants.get(source[0]) || []), index]);
      sources.set(group, variants);
    }
    const canonical = new URL(url);
    canonical.searchParams.sort();
    const identity = canonical.href;
    if (seen.has(identity)) add("DUPLICATE_URL", "warning", "This destination and tracking combination repeats an earlier row (query parameter order ignored).");
    else seen.set(identity, index);
    return { row: index + 1, issues };
  });
  for (const variants of sources.values()) {
    if (variants.size < 2) continue;
    for (const indexes of variants.values()) for (const index of indexes) rows[index].issues.push({
      code: "INCONSISTENT_SOURCE", severity: "warning", message: "The same source uses different capitalization or surrounding whitespace across rows. Review before merging analytics.",
    });
  }
  const issues = rows.flatMap(row => row.issues);
  return { schemaVersion: 1, offline: true, createsResources: false, summary: { rows: rows.length, errors: issues.filter(i => i.severity === "error").length, warnings: issues.filter(i => i.severity === "warning").length }, rows };
}

/** Accepts a url column or the destination_url column exported by Campaign Launch Kit. */
export function lintUtmCsv(raw: string): UtmLintReport {
  const [headers, ...data] = parseCsv(raw);
  if (!headers || new Set(headers).size !== headers.length || !data.length) throw new Error("CSV needs unique headers and 1–100 data rows");
  const candidates = ["url", "destination_url"].filter(key => headers.includes(key));
  if (candidates.length !== 1) throw new Error("CSV needs exactly one url or destination_url column");
  const column = headers.indexOf(candidates[0]);
  const report = lintUtmUrls(data.map(row => row.length === headers.length ? row[column] : ""));
  // Row numbers are logical CSV records, since quoted fields can span physical lines.
  for (const row of report.rows) row.row++;
  return report;
}

export function formatUtmReport(report: UtmLintReport, format: "text" | "github" = "text") {
  const lines: string[] = [];
  for (const row of report.rows) for (const issue of row.issues) {
    const message = `CSV record ${row.row}: ${issue.code} — ${issue.message}`;
    lines.push(format === "github" ? `::${issue.severity}::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}` : `${issue.severity.toUpperCase()} ${message}`);
  }
  lines.push(`${report.summary.rows} URLs checked; ${report.summary.errors} errors; ${report.summary.warnings} warnings. Offline check; no links created.`);
  lines.push("Prepare a campaign: https://linkdevi.com/tools/campaign-launch-kit?utm_source=github&utm_medium=developer_tool&utm_campaign=utm_linter");
  return lines.join("\n") + "\n";
}
