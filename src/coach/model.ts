import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export interface CoachRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}

/** A Claude backend that returns schema-validated output. */
export interface CoachModel {
  generate<T>(req: CoachRequest<T>): Promise<T>;
}

const CliResult = z.object({
  is_error: z.boolean(),
  result: z.string().nullish(),
  structured_output: z.unknown(),
  total_cost_usd: z.number().nullish(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).partial().nullish(),
});

/** Zod's JSON Schema without the `$schema` draft URI, which the CLI's validator rejects. */
function jsonSchema(schema: z.ZodType): object {
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
}

/**
 * Runs Claude through the local `claude` CLI, using its logged-in subscription (e.g. Pro).
 * Free for local testing; not usable from GitHub Actions without a token.
 */
export class ClaudeCliModel implements CoachModel {
  // Empty working dir so no project CLAUDE.md or memory is picked up.
  private readonly cwd = mkdtempSync(join(tmpdir(), "running-coach-"));

  constructor(private readonly model: string) {}

  async generate<T>({ system, prompt, schema }: CoachRequest<T>): Promise<T> {
    const args = [
      "-p",
      "--output-format", "json",
      "--no-session-persistence",
      "--model", this.model,
      "--tools", "",
      "--strict-mcp-config",
      "--system-prompt", system,
      "--json-schema", JSON.stringify(jsonSchema(schema)),
    ];
    const out = CliResult.parse(JSON.parse(await this.run(args, prompt)));
    if (out.is_error) throw new Error(`claude CLI error: ${out.result ?? "unknown"}`);
    const u = out.usage;
    console.error(
      `[coach] ${this.model} via CLI: ${u?.input_tokens ?? "?"} in / ${u?.output_tokens ?? "?"} out` +
        (out.total_cost_usd ? ` (≈$${out.total_cost_usd.toFixed(3)} at API rates)` : ""),
    );
    return schema.parse(out.structured_output);
  }

  private run(args: string[], stdin: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("claude", args, { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(stdout) : reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`)),
      );
      child.stdin.end(stdin);
    });
  }
}

export function createCoachModel(): CoachModel {
  const backend = process.env.COACH_BACKEND ?? "cli";
  const model = process.env.COACH_MODEL ?? "claude-opus-5";
  switch (backend) {
    case "cli":
      return new ClaudeCliModel(model);
    default:
      throw new Error(`Unknown COACH_BACKEND "${backend}" (supported: cli)`);
  }
}
