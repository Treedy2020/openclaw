export type SlashSuggestionKind = "command" | "model" | "skill";

export type SlashSuggestion = {
  kind: SlashSuggestionKind;
  label: string;
  detail?: string;
  insertText: string;
};

type SlashCommandDef = {
  name: string;
  detail: string;
};

const COMMANDS: readonly SlashCommandDef[] = [
  { name: "new", detail: "Start a new session" },
  { name: "stop", detail: "Abort current run" },
  { name: "model", detail: "Set model for the next turn" },
  { name: "skill", detail: "Run a skill by name" },
  { name: "skills", detail: "Manage skill filters (add/remove/list)" },
];

function normalizedValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out.toSorted((a, b) => a.localeCompare(b));
}

function startsWithIgnoreCase(value: string, prefix: string): boolean {
  if (!prefix) {
    return true;
  }
  return value.toLowerCase().startsWith(prefix.toLowerCase());
}

function resolveCommandSuggestions(prefix: string): SlashSuggestion[] {
  return COMMANDS.filter((entry) => startsWithIgnoreCase(entry.name, prefix)).map((entry) => ({
    kind: "command",
    label: `/${entry.name}`,
    detail: entry.detail,
    insertText: `/${entry.name} `,
  }));
}

function resolveModelSuggestions(prefix: string, models: string[]): SlashSuggestion[] {
  const normalizedPrefix = prefix.trim().toLowerCase();
  return normalizedValues(models)
    .filter((model) => {
      if (!normalizedPrefix) {
        return true;
      }
      if (model.toLowerCase().startsWith(normalizedPrefix)) {
        return true;
      }
      const tail = model.split("/").at(-1)?.toLowerCase() ?? "";
      return tail.startsWith(normalizedPrefix);
    })
    .map((model) => ({
      kind: "model",
      label: model,
      detail: "/model",
      insertText: `/model ${model}`,
    }));
}

function resolveSkillSuggestions(
  prefix: string,
  skills: string[],
  base: string,
): SlashSuggestion[] {
  return normalizedValues(skills)
    .filter((skill) => startsWithIgnoreCase(skill, prefix))
    .map((skill) => ({
      kind: "skill",
      label: skill,
      detail: base,
      insertText: `${base} ${skill}`,
    }));
}

export function resolveSlashSuggestions(
  draft: string,
  params: { models: string[]; skills: string[]; limit?: number },
): SlashSuggestion[] {
  const input = draft.trimStart();
  if (!input.startsWith("/")) {
    return [];
  }

  const body = input.slice(1);
  const hasTrailingSpace = /\s$/.test(body);
  const parts = body.split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.floor(params.limit ?? 8));

  if (parts.length === 0) {
    return resolveCommandSuggestions("").slice(0, limit);
  }

  const command = parts[0].toLowerCase();
  const commandPrefix = hasTrailingSpace ? command : parts[0];
  if (parts.length === 1 && !hasTrailingSpace && (command === "model" || command === "skill")) {
    return command === "model"
      ? resolveModelSuggestions("", params.models).slice(0, limit)
      : resolveSkillSuggestions("", params.skills, "/skill").slice(0, limit);
  }
  if (parts.length === 1 && !hasTrailingSpace) {
    return resolveCommandSuggestions(commandPrefix).slice(0, limit);
  }

  if (command === "model") {
    const prefix = hasTrailingSpace ? "" : (parts[parts.length - 1] ?? "");
    return resolveModelSuggestions(prefix, params.models).slice(0, limit);
  }

  if (command === "skill") {
    const prefix = hasTrailingSpace ? "" : (parts[parts.length - 1] ?? "");
    return resolveSkillSuggestions(prefix, params.skills, "/skill").slice(0, limit);
  }

  if (command === "skills") {
    const sub = parts[1]?.toLowerCase() ?? "";
    if (!sub || (parts.length === 2 && !hasTrailingSpace)) {
      const subcommands = ["add", "remove", "list"];
      return subcommands
        .filter((entry) => startsWithIgnoreCase(entry, sub))
        .map((entry) => ({
          kind: "command" as const,
          label: `skills ${entry}`,
          detail: "skills",
          insertText: `/skills ${entry} `,
        }))
        .slice(0, limit);
    }
    if (sub === "add" || sub === "remove") {
      const prefix = hasTrailingSpace ? "" : (parts[parts.length - 1] ?? "");
      return resolveSkillSuggestions(prefix, params.skills, `/skills ${sub}`).slice(0, limit);
    }
  }

  return [];
}
