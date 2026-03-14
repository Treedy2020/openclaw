import { describe, expect, it } from "vitest";
import { extractStructuredMessageLinks } from "./message-links.ts";

describe("extractStructuredMessageLinks", () => {
  it("extracts labeled links from structured JSON payloads", () => {
    const payload = [
      "```json",
      "{",
      '  "status": "success",',
      '  "indexUrl": "https://example.com/share/_index.html",',
      '  "manifestUrl": "https://example.com/share/_manifest.json",',
      '  "files": [{"relativePath":"result/video.mp4","url":"https://example.com/share/video.mp4"}]',
      "}",
      "```",
    ].join("\n");

    const links = extractStructuredMessageLinks(payload, { baseHref: "https://openclaw.ai/chat" });

    expect(links.map((item) => item.label)).toEqual([
      "index Url",
      "manifest Url",
      "result/video.mp4",
    ]);
    expect(links.map((item) => item.url)).toEqual([
      "https://example.com/share/_index.html",
      "https://example.com/share/_manifest.json",
      "https://example.com/share/video.mp4",
    ]);
  });

  it("ignores unsafe links", () => {
    const payload = '{"url":"javascript:alert(1)","safeUrl":"https://example.com/safe"}';
    const links = extractStructuredMessageLinks(payload, { baseHref: "https://openclaw.ai/chat" });
    expect(links.map((item) => item.url)).toEqual(["https://example.com/safe"]);
  });

  it("returns empty list for non-structured text", () => {
    const links = extractStructuredMessageLinks("hello world https://example.com", {
      baseHref: "https://openclaw.ai/chat",
    });
    expect(links).toEqual([]);
  });

  it("decodes escaped JSON URLs in mixed text payloads", () => {
    const text = 'Upload done: {"videoUrl":"https:\\/\\/example.com\\/out.mp4"}';
    const links = extractStructuredMessageLinks(text, { baseHref: "https://openclaw.ai/chat" });
    expect(links.map((item) => item.url)).toEqual(["https://example.com/out.mp4"]);
  });

  it("converts structured file paths into authenticated control-ui download links", () => {
    const payload = [
      "```json",
      "{",
      '  "publishRecordPath": "/srv/openclaw/outputs/final/video.mp4"',
      "}",
      "```",
    ].join("\n");

    const links = extractStructuredMessageLinks(payload, {
      baseHref: "https://host/openclaw/chat",
    });

    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe(
      "https://host/openclaw/__openclaw/files/download?path=%2Fsrv%2Fopenclaw%2Foutputs%2Ffinal%2Fvideo.mp4",
    );
  });

  it("supports path-like fields from inline JSON fragments", () => {
    const text = 'done {"filePath":"~/results/report.pdf"}';
    const links = extractStructuredMessageLinks(text, { baseHref: "https://openclaw.ai/chat" });
    expect(links.map((item) => item.url)).toEqual([
      "https://openclaw.ai/__openclaw/files/download?path=%7E%2Fresults%2Freport.pdf",
    ]);
  });
});
