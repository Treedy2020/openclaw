const CHAT_DOCUMENT_MIME_TYPES = new Set([
  "application/msword",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
]);

const CHAT_DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "htm", "html", "pdf"]);

export const CHAT_ATTACHMENT_ACCEPT = [
  "image/*",
  ".pdf",
  ".doc",
  ".docx",
  ".html",
  ".htm",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
].join(",");

function normalizeMimeType(mimeType: string | null | undefined): string {
  return (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function resolveFileExtension(fileName: string | null | undefined): string {
  if (typeof fileName !== "string") {
    return "";
  }
  const normalized = fileName.trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  return dot >= 0 ? normalized.slice(dot + 1) : "";
}

export function isImageChatAttachmentMimeType(mimeType: string | null | undefined): boolean {
  return normalizeMimeType(mimeType).startsWith("image/");
}

export function isSupportedChatAttachmentMimeType(
  mimeType: string | null | undefined,
  fileName?: string | null,
): boolean {
  const mime = normalizeMimeType(mimeType);
  if (mime.startsWith("image/")) {
    return true;
  }
  if (CHAT_DOCUMENT_MIME_TYPES.has(mime)) {
    return true;
  }
  const ext = resolveFileExtension(fileName);
  return CHAT_DOCUMENT_EXTENSIONS.has(ext);
}
