import { describe, expect, it } from "vitest";
import { resolveSlashSuggestions } from "./slash-autocomplete.ts";

describe("resolveSlashSuggestions", () => {
  it("suggests slash commands for partial command input", () => {
    const result = resolveSlashSuggestions("/mo", { models: [], skills: [] });
    expect(result.map((entry) => entry.insertText)).toEqual(["/model "]);
  });

  it("suggests models for /model command", () => {
    const result = resolveSlashSuggestions("/model open", {
      models: ["openai/gpt-5.4", "anthropic/claude-sonnet-4.5"],
      skills: [],
    });
    expect(result.map((entry) => entry.insertText)).toEqual(["/model openai/gpt-5.4"]);
  });

  it("suggests models when typing bare /model without trailing space", () => {
    const result = resolveSlashSuggestions("/model", {
      models: ["openai/gpt-5.4", "anthropic/claude-sonnet-4.5"],
      skills: [],
    });
    expect(result.map((entry) => entry.insertText)).toEqual([
      "/model anthropic/claude-sonnet-4.5",
      "/model openai/gpt-5.4",
    ]);
  });

  it("matches model suggestions by id suffix for tab completion", () => {
    const result = resolveSlashSuggestions("/model gpt-5", {
      models: ["openai/gpt-5.4", "anthropic/claude-sonnet-4.5"],
      skills: [],
    });
    expect(result.map((entry) => entry.insertText)).toEqual(["/model openai/gpt-5.4"]);
  });

  it("suggests skills for /skill command", () => {
    const result = resolveSlashSuggestions("/skill fei", {
      models: [],
      skills: ["feishu_chat", "web_search"],
    });
    expect(result.map((entry) => entry.insertText)).toEqual(["/skill feishu_chat"]);
  });

  it("suggests skills when typing bare /skill without trailing space", () => {
    const result = resolveSlashSuggestions("/skill", {
      models: [],
      skills: ["feishu_chat", "web_search"],
    });
    expect(result.map((entry) => entry.insertText)).toEqual([
      "/skill feishu_chat",
      "/skill web_search",
    ]);
  });

  it("suggests skills add/remove subcommands and skill names", () => {
    const subcommand = resolveSlashSuggestions("/skills a", { models: [], skills: ["lint_fix"] });
    expect(subcommand.map((entry) => entry.insertText)).toEqual(["/skills add "]);

    const skill = resolveSlashSuggestions("/skills remove l", {
      models: [],
      skills: ["lint_fix", "test_runner"],
    });
    expect(skill.map((entry) => entry.insertText)).toEqual(["/skills remove lint_fix"]);
  });

  it("returns empty list for non-slash drafts", () => {
    expect(resolveSlashSuggestions("hello", { models: ["x"], skills: ["y"] })).toEqual([]);
  });
});
