import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { openBoundaryFileSync } from "../infra/boundary-file-read.js";
import {
  isPackageProvenControlUiRootSync,
  resolveControlUiRootSync,
} from "../infra/control-ui-assets.js";
import { isWithinDir } from "../infra/path-safety.js";
import { openVerifiedFileSync } from "../infra/safe-open-sync.js";
import { safeEqualSecret } from "../security/secret-equal.js";
import { AVATAR_MAX_BYTES } from "../shared/avatar-policy.js";
import { resolveRuntimeServiceVersion } from "../version.js";
import { DEFAULT_ASSISTANT_IDENTITY, resolveAssistantIdentity } from "./assistant-identity.js";
import {
  CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
  CONTROL_UI_FILE_DOWNLOAD_PATH,
  type ControlUiBootstrapConfig,
} from "./control-ui-contract.js";
import { buildControlUiCspHeader } from "./control-ui-csp.js";
import {
  isReadHttpMethod,
  respondNotFound as respondControlUiNotFound,
  respondPlainText,
} from "./control-ui-http-utils.js";
import { classifyControlUiRequest } from "./control-ui-routing.js";
import {
  buildControlUiAvatarUrl,
  CONTROL_UI_AVATAR_PREFIX,
  normalizeControlUiBasePath,
  resolveAssistantAvatarUrl,
} from "./control-ui-shared.js";

const ROOT_PREFIX = "/";
const CONTROL_UI_ASSETS_MISSING_MESSAGE =
  "Control UI assets not found. Build them with `pnpm ui:build` (auto-installs UI deps), or run `pnpm ui:dev` during development.";
const CONTROL_UI_SIMPLE_KEY_QUERY_PARAM = "key";
const CONTROL_UI_SIMPLE_KEY_HEADER = "x-openclaw-access-key";
const CONTROL_UI_SIMPLE_KEY_COOKIE = "openclaw_ui_key";
const CONTROL_UI_SIMPLE_KEY_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
const CONTROL_UI_FILE_DOWNLOAD_QUERY_PARAM = "path";

export type ControlUiRequestOptions = {
  basePath?: string;
  config?: OpenClawConfig;
  agentId?: string;
  root?: ControlUiRootState;
};

export type ControlUiRootState =
  | { kind: "bundled"; path: string }
  | { kind: "resolved"; path: string }
  | { kind: "invalid"; path: string }
  | { kind: "missing" };

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

/**
 * Extensions recognised as static assets.  Missing files with these extensions
 * return 404 instead of the SPA index.html fallback.  `.html` is intentionally
 * excluded — actual HTML files on disk are served earlier, and missing `.html`
 * paths should fall through to the SPA router (client-side routers may use
 * `.html`-suffixed routes).
 */
const STATIC_ASSET_EXTENSIONS = new Set([
  ".js",
  ".css",
  ".json",
  ".map",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".txt",
]);

export type ControlUiAvatarResolution =
  | { kind: "none"; reason: string }
  | { kind: "local"; filePath: string }
  | { kind: "remote"; url: string }
  | { kind: "data"; url: string };

type ControlUiAvatarMeta = {
  avatarUrl: string | null;
};

function applyControlUiSecurityHeaders(res: ServerResponse) {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", buildControlUiCspHeader());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(JSON.stringify(body));
}

function normalizeControlUiSimpleKey(config?: OpenClawConfig): string | null {
  const value = config?.gateway?.controlUi?.simpleKey;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildAttachmentContentDisposition(fileName: string): string {
  const fallback = fileName.replace(/["\\]/g, "_") || "download";
  const encoded = encodeURIComponent(fileName || "download").replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function expandUserHomePath(filePath: string): string {
  const trimmed = filePath.trim();
  if (trimmed === "~" || trimmed === "~/") {
    return process.env.HOME ?? trimmed;
  }
  if (trimmed.startsWith("~/")) {
    const home = process.env.HOME;
    if (home) {
      return path.join(home, trimmed.slice(2));
    }
  }
  return trimmed;
}

function resolveRequestedDownloadPath(rawPath: string): string | null {
  const expanded = expandUserHomePath(rawPath);
  if (!expanded || expanded.includes("\0")) {
    return null;
  }
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded);
  }
  return path.resolve(process.cwd(), expanded);
}

function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "string") {
      const trimmed = first.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

function parseCookieValue(rawCookieHeader: string | undefined, name: string): string | null {
  if (!rawCookieHeader) {
    return null;
  }
  const parts = rawCookieHeader.split(";");
  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    if (!rawKey || rest.length === 0) {
      continue;
    }
    if (rawKey.trim() !== name) {
      continue;
    }
    const joined = rest.join("=").trim();
    if (!joined) {
      return null;
    }
    try {
      const decoded = decodeURIComponent(joined);
      return decoded.trim() || null;
    } catch {
      return joined.trim() || null;
    }
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function respondControlUiSimpleKeyRequired(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
) {
  res.statusCode = 401;
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const safePath = escapeHtml(pathname || "/");
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access key required</title></head><body><main style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:460px;margin:10vh auto;padding:24px;border:1px solid #ddd;border-radius:12px"><h1 style="margin:0 0 8px;font-size:22px">Access key required</h1><p style="margin:0 0 14px;color:#555">Enter your Control UI key to continue.</p><form method="GET" action="${safePath}"><label for="control-ui-key" style="display:block;font-weight:600;margin-bottom:8px">Key</label><input id="control-ui-key" name="${CONTROL_UI_SIMPLE_KEY_QUERY_PARAM}" type="password" autocomplete="current-password" required style="width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:8px"><button type="submit" style="margin-top:12px;padding:10px 14px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer">Continue</button></form><p style="margin:12px 0 0;color:#777;font-size:12px">Tip: you can also send header ${CONTROL_UI_SIMPLE_KEY_HEADER}.</p></main></body></html>`,
  );
}

function authorizeControlUiSimpleKey(params: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  configuredKey: string;
}): boolean {
  const queryKey = params.url.searchParams.get(CONTROL_UI_SIMPLE_KEY_QUERY_PARAM)?.trim() ?? "";
  const headerKey = headerValue(params.req.headers?.[CONTROL_UI_SIMPLE_KEY_HEADER]);
  const cookieKey = parseCookieValue(
    headerValue(params.req.headers?.cookie) ?? undefined,
    CONTROL_UI_SIMPLE_KEY_COOKIE,
  );
  const candidate = queryKey || headerKey || cookieKey;
  if (!candidate || !safeEqualSecret(candidate, params.configuredKey)) {
    respondControlUiSimpleKeyRequired(params.req, params.res, params.url.pathname);
    return false;
  }
  if (queryKey || headerKey) {
    params.res.setHeader(
      "Set-Cookie",
      `${CONTROL_UI_SIMPLE_KEY_COOKIE}=${encodeURIComponent(params.configuredKey)}; Path=/; Max-Age=${CONTROL_UI_SIMPLE_KEY_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`,
    );
  }
  return true;
}

function respondControlUiAssetsUnavailable(
  res: ServerResponse,
  options?: { configuredRootPath?: string },
) {
  if (options?.configuredRootPath) {
    respondPlainText(
      res,
      503,
      `Control UI assets not found at ${options.configuredRootPath}. Build them with \`pnpm ui:build\` (auto-installs UI deps), or update gateway.controlUi.root.`,
    );
    return;
  }
  respondPlainText(res, 503, CONTROL_UI_ASSETS_MISSING_MESSAGE);
}

function respondHeadForFile(req: IncomingMessage, res: ServerResponse, filePath: string): boolean {
  if (req.method !== "HEAD") {
    return false;
  }
  res.statusCode = 200;
  setStaticFileHeaders(res, filePath);
  res.end();
  return true;
}

function isValidAgentId(agentId: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(agentId);
}

export function handleControlUiAvatarRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    basePath?: string;
    config?: OpenClawConfig;
    resolveAvatar: (agentId: string) => ControlUiAvatarResolution;
  },
): boolean {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  if (!isReadHttpMethod(req.method)) {
    return false;
  }

  const url = new URL(urlRaw, "http://localhost");
  const basePath = normalizeControlUiBasePath(opts.basePath);
  const pathname = url.pathname;
  const pathWithBase = basePath
    ? `${basePath}${CONTROL_UI_AVATAR_PREFIX}/`
    : `${CONTROL_UI_AVATAR_PREFIX}/`;
  if (!pathname.startsWith(pathWithBase)) {
    return false;
  }

  applyControlUiSecurityHeaders(res);
  const configuredSimpleKey = normalizeControlUiSimpleKey(opts.config);
  if (
    configuredSimpleKey &&
    !authorizeControlUiSimpleKey({
      req,
      res,
      url,
      configuredKey: configuredSimpleKey,
    })
  ) {
    return true;
  }

  const agentIdParts = pathname.slice(pathWithBase.length).split("/").filter(Boolean);
  const agentId = agentIdParts[0] ?? "";
  if (agentIdParts.length !== 1 || !agentId || !isValidAgentId(agentId)) {
    respondControlUiNotFound(res);
    return true;
  }

  if (url.searchParams.get("meta") === "1") {
    const resolved = opts.resolveAvatar(agentId);
    const avatarUrl =
      resolved.kind === "local"
        ? buildControlUiAvatarUrl(basePath, agentId)
        : resolved.kind === "remote" || resolved.kind === "data"
          ? resolved.url
          : null;
    sendJson(res, 200, { avatarUrl } satisfies ControlUiAvatarMeta);
    return true;
  }

  const resolved = opts.resolveAvatar(agentId);
  if (resolved.kind !== "local") {
    respondControlUiNotFound(res);
    return true;
  }

  const safeAvatar = resolveSafeAvatarFile(resolved.filePath);
  if (!safeAvatar) {
    respondControlUiNotFound(res);
    return true;
  }
  try {
    if (respondHeadForFile(req, res, safeAvatar.path)) {
      return true;
    }

    serveResolvedFile(res, safeAvatar.path, fs.readFileSync(safeAvatar.fd));
    return true;
  } finally {
    fs.closeSync(safeAvatar.fd);
  }
}

function setStaticFileHeaders(res: ServerResponse, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader("Content-Type", contentTypeForExt(ext));
  // Static UI should never be cached aggressively while iterating; allow the
  // browser to revalidate.
  res.setHeader("Cache-Control", "no-cache");
}

function serveResolvedFile(res: ServerResponse, filePath: string, body: Buffer) {
  setStaticFileHeaders(res, filePath);
  res.end(body);
}

function serveResolvedIndexHtml(res: ServerResponse, body: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(body);
}

function isExpectedSafePathError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

function resolveSafeAvatarFile(filePath: string): { path: string; fd: number } | null {
  const opened = openVerifiedFileSync({
    filePath,
    rejectPathSymlink: true,
    maxBytes: AVATAR_MAX_BYTES,
  });
  if (!opened.ok) {
    return null;
  }
  return { path: opened.path, fd: opened.fd };
}

function resolveSafeControlUiFile(
  rootReal: string,
  filePath: string,
  rejectHardlinks: boolean,
): { path: string; fd: number } | null {
  const opened = openBoundaryFileSync({
    absolutePath: filePath,
    rootPath: rootReal,
    rootRealPath: rootReal,
    boundaryLabel: "control ui root",
    skipLexicalRootCheck: true,
    rejectHardlinks,
  });
  if (!opened.ok) {
    if (opened.reason === "io") {
      throw opened.error;
    }
    return null;
  }
  return { path: opened.path, fd: opened.fd };
}

function isSafeRelativePath(relPath: string) {
  if (!relPath) {
    return false;
  }
  const normalized = path.posix.normalize(relPath);
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    return false;
  }
  if (normalized.startsWith("../") || normalized === "..") {
    return false;
  }
  if (normalized.includes("\0")) {
    return false;
  }
  return true;
}

function handleControlUiFileDownloadRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  basePath: string;
  configuredSimpleKey: string | null;
}): boolean {
  const endpointPath = params.basePath
    ? `${params.basePath}${CONTROL_UI_FILE_DOWNLOAD_PATH}`
    : CONTROL_UI_FILE_DOWNLOAD_PATH;
  if (params.url.pathname !== endpointPath) {
    return false;
  }

  if (!params.configuredSimpleKey) {
    respondPlainText(
      params.res,
      403,
      "File download endpoint requires gateway.controlUi.simpleKey to be configured.",
    );
    return true;
  }

  const rawPath = params.url.searchParams.get(CONTROL_UI_FILE_DOWNLOAD_QUERY_PARAM)?.trim() ?? "";
  if (!rawPath) {
    respondPlainText(
      params.res,
      400,
      `Missing query parameter: ${CONTROL_UI_FILE_DOWNLOAD_QUERY_PARAM}`,
    );
    return true;
  }
  const filePath = resolveRequestedDownloadPath(rawPath);
  if (!filePath) {
    respondControlUiNotFound(params.res);
    return true;
  }

  const opened = openVerifiedFileSync({
    filePath,
    rejectPathSymlink: true,
    allowedType: "file",
  });
  if (!opened.ok) {
    if (opened.reason === "io") {
      respondPlainText(params.res, 500, "Failed to read requested file.");
      return true;
    }
    respondControlUiNotFound(params.res);
    return true;
  }

  const contentDisposition = buildAttachmentContentDisposition(path.basename(opened.path));
  params.res.statusCode = 200;
  setStaticFileHeaders(params.res, opened.path);
  params.res.setHeader("Content-Disposition", contentDisposition);
  params.res.setHeader("Content-Length", String(opened.stat.size));
  params.res.setHeader("Cache-Control", "no-store");

  if (params.req.method === "HEAD") {
    fs.closeSync(opened.fd);
    params.res.end();
    return true;
  }

  const stream = fs.createReadStream(opened.path, {
    fd: opened.fd,
    autoClose: true,
  });
  stream.on("error", () => {
    if (!params.res.headersSent) {
      respondPlainText(params.res, 500, "Failed while streaming file.");
      return;
    }
    params.res.destroy();
  });
  stream.pipe(params.res);
  return true;
}

export function handleControlUiHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts?: ControlUiRequestOptions,
): boolean {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  const url = new URL(urlRaw, "http://localhost");
  const basePath = normalizeControlUiBasePath(opts?.basePath);
  const pathname = url.pathname;
  const route = classifyControlUiRequest({
    basePath,
    pathname,
    search: url.search,
    method: req.method,
  });
  if (route.kind === "not-control-ui") {
    return false;
  }
  applyControlUiSecurityHeaders(res);
  const configuredSimpleKey = normalizeControlUiSimpleKey(opts?.config);
  if (
    configuredSimpleKey &&
    !authorizeControlUiSimpleKey({
      req,
      res,
      url,
      configuredKey: configuredSimpleKey,
    })
  ) {
    return true;
  }
  if (
    handleControlUiFileDownloadRequest({
      req,
      res,
      url,
      basePath,
      configuredSimpleKey,
    })
  ) {
    return true;
  }
  if (route.kind === "not-found") {
    respondControlUiNotFound(res);
    return true;
  }
  if (route.kind === "redirect") {
    res.statusCode = 302;
    res.setHeader("Location", route.location);
    res.end();
    return true;
  }

  const bootstrapConfigPath = basePath
    ? `${basePath}${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`
    : CONTROL_UI_BOOTSTRAP_CONFIG_PATH;
  if (pathname === bootstrapConfigPath) {
    const config = opts?.config;
    const identity = config
      ? resolveAssistantIdentity({ cfg: config, agentId: opts?.agentId })
      : DEFAULT_ASSISTANT_IDENTITY;
    const avatarValue = resolveAssistantAvatarUrl({
      avatar: identity.avatar,
      agentId: identity.agentId,
      basePath,
    });
    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.end();
      return true;
    }
    sendJson(res, 200, {
      basePath,
      assistantName: identity.name,
      assistantAvatar: avatarValue ?? identity.avatar,
      assistantAgentId: identity.agentId,
      serverVersion: resolveRuntimeServiceVersion(process.env),
    } satisfies ControlUiBootstrapConfig);
    return true;
  }

  const rootState = opts?.root;
  if (rootState?.kind === "invalid") {
    respondControlUiAssetsUnavailable(res, { configuredRootPath: rootState.path });
    return true;
  }
  if (rootState?.kind === "missing") {
    respondControlUiAssetsUnavailable(res);
    return true;
  }

  const root =
    rootState?.kind === "resolved" || rootState?.kind === "bundled"
      ? rootState.path
      : resolveControlUiRootSync({
          moduleUrl: import.meta.url,
          argv1: process.argv[1],
          cwd: process.cwd(),
        });
  if (!root) {
    respondControlUiAssetsUnavailable(res);
    return true;
  }

  const rootReal = (() => {
    try {
      return fs.realpathSync(root);
    } catch (error) {
      if (isExpectedSafePathError(error)) {
        return null;
      }
      throw error;
    }
  })();
  if (!rootReal) {
    respondControlUiAssetsUnavailable(res);
    return true;
  }

  const uiPath =
    basePath && pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname;
  const rel = (() => {
    if (uiPath === ROOT_PREFIX) {
      return "";
    }
    const assetsIndex = uiPath.indexOf("/assets/");
    if (assetsIndex >= 0) {
      return uiPath.slice(assetsIndex + 1);
    }
    return uiPath.slice(1);
  })();
  const requested = rel && !rel.endsWith("/") ? rel : `${rel}index.html`;
  const fileRel = requested || "index.html";
  if (!isSafeRelativePath(fileRel)) {
    respondControlUiNotFound(res);
    return true;
  }

  const filePath = path.resolve(root, fileRel);
  if (!isWithinDir(root, filePath)) {
    respondControlUiNotFound(res);
    return true;
  }

  const isBundledRoot =
    rootState?.kind === "bundled" ||
    (rootState === undefined &&
      isPackageProvenControlUiRootSync(root, {
        moduleUrl: import.meta.url,
        argv1: process.argv[1],
        cwd: process.cwd(),
      }));
  const rejectHardlinks = !isBundledRoot;
  const safeFile = resolveSafeControlUiFile(rootReal, filePath, rejectHardlinks);
  if (safeFile) {
    try {
      if (respondHeadForFile(req, res, safeFile.path)) {
        return true;
      }
      if (path.basename(safeFile.path) === "index.html") {
        serveResolvedIndexHtml(res, fs.readFileSync(safeFile.fd, "utf8"));
        return true;
      }
      serveResolvedFile(res, safeFile.path, fs.readFileSync(safeFile.fd));
      return true;
    } finally {
      fs.closeSync(safeFile.fd);
    }
  }

  // If the requested path looks like a static asset (known extension), return
  // 404 rather than falling through to the SPA index.html fallback.  We check
  // against the same set of extensions that contentTypeForExt() recognises so
  // that dotted SPA routes (e.g. /user/jane.doe, /v2.0) still get the
  // client-side router fallback.
  if (STATIC_ASSET_EXTENSIONS.has(path.extname(fileRel).toLowerCase())) {
    respondControlUiNotFound(res);
    return true;
  }

  // SPA fallback (client-side router): serve index.html for unknown paths.
  const indexPath = path.join(root, "index.html");
  const safeIndex = resolveSafeControlUiFile(rootReal, indexPath, rejectHardlinks);
  if (safeIndex) {
    try {
      if (respondHeadForFile(req, res, safeIndex.path)) {
        return true;
      }
      serveResolvedIndexHtml(res, fs.readFileSync(safeIndex.fd, "utf8"));
      return true;
    } finally {
      fs.closeSync(safeIndex.fd);
    }
  }

  respondControlUiNotFound(res);
  return true;
}
