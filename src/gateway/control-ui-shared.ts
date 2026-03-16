import {
  isAvatarHttpUrl,
  isAvatarImageDataUrl,
  looksLikeAvatarPath,
} from "../shared/avatar-policy.js";

const CONTROL_UI_AVATAR_PREFIX = "/avatar";

export function normalizeControlUiBasePath(basePath?: string): string {
  if (!basePath) {
    return "";
  }
  let normalized = basePath.trim();
  if (!normalized) {
    return "";
  }
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized === "/") {
    return "";
  }
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function buildControlUiAvatarUrl(basePath: string, agentId: string): string {
  return basePath
    ? `${basePath}${CONTROL_UI_AVATAR_PREFIX}/${agentId}`
    : `${CONTROL_UI_AVATAR_PREFIX}/${agentId}`;
}

export function resolveAssistantAvatarUrl(params: {
  avatar?: string | null;
  agentId?: string | null;
  basePath?: string;
}): string | undefined {
  const avatar = params.avatar?.trim();
  if (!avatar) {
    return undefined;
  }
  if (isAvatarHttpUrl(avatar) || isAvatarImageDataUrl(avatar)) {
    return avatar;
  }

  const basePath = normalizeControlUiBasePath(params.basePath);
  const baseAvatarPrefix = basePath
    ? `${basePath}${CONTROL_UI_AVATAR_PREFIX}/`
    : `${CONTROL_UI_AVATAR_PREFIX}/`;
  // Keep absolute static asset paths (e.g. "/icon.jpeg") as-is instead of proxying via /avatar/:id.
  // This avoids broken assistant avatars when users intentionally point at bundled UI assets.
  if (avatar.startsWith("/") && !avatar.startsWith(`${CONTROL_UI_AVATAR_PREFIX}/`)) {
    return basePath ? `${basePath}${avatar}` : avatar;
  }
  if (basePath && avatar.startsWith(`${CONTROL_UI_AVATAR_PREFIX}/`)) {
    return `${basePath}${avatar}`;
  }
  if (avatar.startsWith(baseAvatarPrefix)) {
    return avatar;
  }

  if (!params.agentId) {
    return avatar;
  }
  if (looksLikeAvatarPath(avatar)) {
    return buildControlUiAvatarUrl(basePath, params.agentId);
  }
  return avatar;
}

export { CONTROL_UI_AVATAR_PREFIX };
