import { CONTROL_UI_FILE_OPEN_PATH } from "../../../../src/gateway/control-ui-contract.js";
import { resolveSafeExternalUrl } from "../open-external-url.ts";

export type StructuredMessageLink = {
  label: string;
  url: string;
  meta: string;
};

const STRUCTURED_HINT_RE =
  /```(?:json|jsonc)?|"(?:[^"]*(?:url|href|link|path|file|record|directory|dir)[^"]*)"\s*:/i;
const URL_KEY_RE = /(url|href|link)$/i;
const PATH_KEY_RE = /(path|file|record|directory|dir)$/i;
const BARE_URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const JSON_CODE_BLOCK_RE = /```(?:json|jsonc)?\s*([\s\S]*?)```/gi;
const DEFAULT_MAX_LINKS = 12;

function normalizeLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "Link";
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return trimmed;
  }
  const cleaned = raw
    .replace(/\[\d+\]/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return cleaned || "Link";
}

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[),.;!?]+$/g, "");
}

function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\\//g, "/").replace(/\\\\/g, "\\");
  }
}

function summarizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

function looksLikeFilesystemPath(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("/") ||
    trimmed.startsWith("~/") ||
    /^[a-z]:[\\/]/i.test(trimmed) ||
    trimmed.startsWith("\\\\")
  );
}

function toControlUiFileOpenUrl(filePath: string, baseHref: string): string {
  const endpointRel = CONTROL_UI_FILE_OPEN_PATH.replace(/^\/+/, "");
  const endpoint = new URL(endpointRel, baseHref);
  endpoint.searchParams.set("path", filePath.trim());
  return endpoint.toString();
}

function pushLink(
  links: StructuredMessageLink[],
  seen: Set<string>,
  rawUrl: string,
  rawLabel: string,
  baseHref: string,
) {
  const normalized = resolveSafeExternalUrl(trimTrailingPunctuation(rawUrl), baseHref);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  links.push({
    label: normalizeLabel(rawLabel),
    url: normalized,
    meta: summarizeUrl(normalized),
  });
}

function collectLinksFromObject(
  value: unknown,
  links: StructuredMessageLink[],
  seen: Set<string>,
  baseHref: string,
  contextLabel?: string,
) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectLinksFromObject(item, links, seen, baseHref, contextLabel);
    }
    return;
  }

  const obj = value as Record<string, unknown>;
  const contextCandidate =
    typeof obj.relativePath === "string"
      ? obj.relativePath
      : typeof obj.name === "string"
        ? obj.name
        : typeof obj.file === "string"
          ? obj.file
          : contextLabel;

  for (const [key, nested] of Object.entries(obj)) {
    if (typeof nested === "string" && URL_KEY_RE.test(key)) {
      const label = key.toLowerCase() === "url" && contextCandidate ? contextCandidate : key;
      pushLink(links, seen, nested, label, baseHref);
      continue;
    }
    if (typeof nested === "string" && PATH_KEY_RE.test(key) && looksLikeFilesystemPath(nested)) {
      const label = key.toLowerCase() === "path" && contextCandidate ? contextCandidate : key;
      pushLink(links, seen, toControlUiFileOpenUrl(nested, baseHref), label, baseHref);
      continue;
    }

    if (typeof nested === "object" && nested !== null) {
      collectLinksFromObject(nested, links, seen, baseHref, key);
    }
  }
}

function collectJsonCandidates(text: string): string[] {
  const matches = Array.from(text.matchAll(JSON_CODE_BLOCK_RE), (match) => match[1].trim()).filter(
    Boolean,
  );
  if (matches.length > 0) {
    return matches;
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return [trimmed];
  }
  return [];
}

type ParsedJsonCandidate = { ok: true; value: unknown } | { ok: false };

function parseJsonCandidate(candidate: string): ParsedJsonCandidate {
  try {
    return { ok: true, value: JSON.parse(candidate) as unknown };
  } catch {
    return { ok: false };
  }
}

function collectKeyValueLinks(
  text: string,
  links: StructuredMessageLink[],
  seen: Set<string>,
  baseHref: string,
) {
  const keyValueRe =
    /"([^"]*(?:url|href|link|path|file|record|directory|dir)[^"]*)"\s*:\s*"((?:\\.|[^"\\])+)"/gi;
  for (const match of text.matchAll(keyValueRe)) {
    const key = match[1] ?? "Link";
    const encoded = match[2] ?? "";
    const decoded = decodeJsonString(encoded);
    if (URL_KEY_RE.test(key)) {
      pushLink(links, seen, decoded, key, baseHref);
      continue;
    }
    if (PATH_KEY_RE.test(key) && looksLikeFilesystemPath(decoded)) {
      pushLink(links, seen, toControlUiFileOpenUrl(decoded, baseHref), key, baseHref);
    }
  }
}

function collectBareLinks(
  text: string,
  links: StructuredMessageLink[],
  seen: Set<string>,
  baseHref: string,
) {
  let index = links.length + 1;
  for (const match of text.matchAll(BARE_URL_RE)) {
    const url = match[0] ?? "";
    pushLink(links, seen, url, `Link ${index}`, baseHref);
    index += 1;
  }
}

export function extractStructuredMessageLinks(
  text: string,
  opts: { baseHref?: string; maxLinks?: number } = {},
): StructuredMessageLink[] {
  const input = text.trim();
  if (!input || !STRUCTURED_HINT_RE.test(input)) {
    return [];
  }

  const baseHref =
    opts.baseHref ??
    (typeof window !== "undefined" && window.location?.href
      ? window.location.href
      : "https://localhost/");
  const maxLinks = Math.max(1, opts.maxLinks ?? DEFAULT_MAX_LINKS);
  const links: StructuredMessageLink[] = [];
  const seen = new Set<string>();

  for (const candidate of collectJsonCandidates(input)) {
    const parsed = parseJsonCandidate(candidate);
    if (!parsed.ok) {
      continue;
    }
    collectLinksFromObject(parsed.value, links, seen, baseHref);
    if (links.length >= maxLinks) {
      return links.slice(0, maxLinks);
    }
  }

  collectKeyValueLinks(input, links, seen, baseHref);
  if (links.length >= maxLinks) {
    return links.slice(0, maxLinks);
  }

  collectBareLinks(input, links, seen, baseHref);
  return links.slice(0, maxLinks);
}
