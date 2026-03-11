import { describe, expect, it } from "vitest";
import {
  resolveConfiguredCronModelSuggestions,
  resolveConfiguredSkillSuggestions,
  resolveEffectiveModelFallbacks,
  resolveInstalledUsableSkillSuggestions,
  resolveUsableSkillSuggestions,
  sortLocaleStrings,
} from "./agents-utils.ts";

describe("resolveEffectiveModelFallbacks", () => {
  it("inherits defaults when no entry fallbacks are configured", () => {
    const entryModel = undefined;
    const defaultModel = {
      primary: "openai/gpt-5-nano",
      fallbacks: ["google/gemini-2.0-flash"],
    };

    expect(resolveEffectiveModelFallbacks(entryModel, defaultModel)).toEqual([
      "google/gemini-2.0-flash",
    ]);
  });

  it("prefers entry fallbacks over defaults", () => {
    const entryModel = {
      primary: "openai/gpt-5-mini",
      fallbacks: ["openai/gpt-5-nano"],
    };
    const defaultModel = {
      primary: "openai/gpt-5",
      fallbacks: ["google/gemini-2.0-flash"],
    };

    expect(resolveEffectiveModelFallbacks(entryModel, defaultModel)).toEqual(["openai/gpt-5-nano"]);
  });

  it("keeps explicit empty entry fallback lists", () => {
    const entryModel = {
      primary: "openai/gpt-5-mini",
      fallbacks: [],
    };
    const defaultModel = {
      primary: "openai/gpt-5",
      fallbacks: ["google/gemini-2.0-flash"],
    };

    expect(resolveEffectiveModelFallbacks(entryModel, defaultModel)).toEqual([]);
  });
});

describe("resolveConfiguredCronModelSuggestions", () => {
  it("collects defaults primary/fallbacks, alias map keys, and per-agent model entries", () => {
    const result = resolveConfiguredCronModelSuggestions({
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5.2",
            fallbacks: ["google/gemini-2.5-pro", "openai/gpt-5.2-mini"],
          },
          models: {
            "anthropic/claude-sonnet-4-5": { alias: "smart" },
            "openai/gpt-5.2": { alias: "main" },
          },
        },
        list: {
          writer: {
            model: { primary: "xai/grok-4", fallbacks: ["openai/gpt-5.2-mini"] },
          },
          planner: {
            model: "google/gemini-2.5-flash",
          },
        },
      },
    });

    expect(result).toEqual([
      "anthropic/claude-sonnet-4-5",
      "google/gemini-2.5-flash",
      "google/gemini-2.5-pro",
      "openai/gpt-5.2",
      "openai/gpt-5.2-mini",
      "xai/grok-4",
    ]);
  });

  it("returns empty array for invalid or missing config shape", () => {
    expect(resolveConfiguredCronModelSuggestions(null)).toEqual([]);
    expect(resolveConfiguredCronModelSuggestions({})).toEqual([]);
    expect(resolveConfiguredCronModelSuggestions({ agents: { defaults: { model: "" } } })).toEqual(
      [],
    );
  });
});

describe("resolveConfiguredSkillSuggestions", () => {
  it("collects configured agent skills from list entries", () => {
    const result = resolveConfiguredSkillSuggestions({
      agents: {
        list: [
          { id: "main", skills: ["feishu_chat", " web_search ", ""] },
          { id: "writer", skills: ["web_search", "calendar"] },
          { id: "noop", skills: ["   "] },
        ],
      },
    });

    expect(result).toEqual(["calendar", "feishu_chat", "web_search"]);
  });

  it("returns empty array for invalid shapes", () => {
    expect(resolveConfiguredSkillSuggestions(null)).toEqual([]);
    expect(resolveConfiguredSkillSuggestions({})).toEqual([]);
    expect(resolveConfiguredSkillSuggestions({ agents: { list: {} } })).toEqual([]);
  });
});

describe("resolveUsableSkillSuggestions", () => {
  it("only returns installed and usable skills", () => {
    const result = resolveUsableSkillSuggestions([
      {
        name: "feishu_chat",
        description: "",
        source: "",
        filePath: "",
        baseDir: "",
        skillKey: "feishu_chat",
        always: false,
        disabled: false,
        blockedByAllowlist: false,
        eligible: true,
        requirements: { bins: [], env: [], config: [], os: [] },
        missing: { bins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
      {
        name: "web_search",
        description: "",
        source: "",
        filePath: "",
        baseDir: "",
        skillKey: "web_search",
        always: false,
        disabled: true,
        blockedByAllowlist: false,
        eligible: true,
        requirements: { bins: [], env: [], config: [], os: [] },
        missing: { bins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
      {
        name: "calendar",
        description: "",
        source: "",
        filePath: "",
        baseDir: "",
        skillKey: "calendar",
        always: false,
        disabled: false,
        blockedByAllowlist: true,
        eligible: true,
        requirements: { bins: [], env: [], config: [], os: [] },
        missing: { bins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
      {
        name: "todo",
        description: "",
        source: "",
        filePath: "",
        baseDir: "",
        skillKey: "todo",
        always: false,
        disabled: false,
        blockedByAllowlist: false,
        eligible: false,
        requirements: { bins: [], env: [], config: [], os: [] },
        missing: { bins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
    ]);

    expect(result).toEqual(["feishu_chat"]);
  });
});

describe("resolveInstalledUsableSkillSuggestions", () => {
  it("excludes bundled skills and only keeps installed usable skills", () => {
    const result = resolveInstalledUsableSkillSuggestions([
      {
        name: "feishu-doc",
        description: "",
        source: "openclaw-extra",
        filePath: "",
        baseDir: "",
        skillKey: "feishu-doc",
        bundled: false,
        always: false,
        disabled: false,
        blockedByAllowlist: false,
        eligible: true,
        requirements: { bins: [], env: [], config: [], os: [] },
        missing: { bins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
      {
        name: "github",
        description: "",
        source: "openclaw-bundled",
        filePath: "",
        baseDir: "",
        skillKey: "github",
        bundled: true,
        always: false,
        disabled: false,
        blockedByAllowlist: false,
        eligible: true,
        requirements: { bins: [], env: [], config: [], os: [] },
        missing: { bins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
    ]);

    expect(result).toEqual(["feishu-doc"]);
  });
});

describe("sortLocaleStrings", () => {
  it("sorts values using localeCompare without relying on Array.prototype.toSorted", () => {
    expect(sortLocaleStrings(["z", "b", "a"])).toEqual(["a", "b", "z"]);
  });

  it("accepts any iterable input, including sets", () => {
    expect(sortLocaleStrings(new Set(["beta", "alpha"]))).toEqual(["alpha", "beta"]);
  });
});
