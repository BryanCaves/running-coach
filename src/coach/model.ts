import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { requireEnv } from "../config.ts";

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

const GeminiResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z.object({ promptTokenCount: z.number(), candidatesTokenCount: z.number() }).partial().optional(),
});

/**
 * Google Gemini via its REST API. Opt-in for a fully free setup: on Gemini's free tier, Google may use
 * prompts and responses to improve its products, and human reviewers may read them (see README).
 */
export class GeminiModel implements CoachModel {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async generate<T>({ system, prompt, schema }: CoachRequest<T>): Promise<T> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: jsonSchema(schema) },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = GeminiResponse.parse(await res.json());
    const candidate = body.candidates?.[0];
    const text = candidate?.content?.parts.map((p) => p.text ?? "").join("");
    if (!text) {
      const reason = body.promptFeedback?.blockReason ?? candidate?.finishReason ?? "unknown";
      throw new Error(`Gemini returned no content (${reason})`);
    }
    const u = body.usageMetadata;
    console.error(`[coach] ${this.model} via Gemini: ${u?.promptTokenCount ?? "?"} in / ${u?.candidatesTokenCount ?? "?"} out`);
    return schema.parse(JSON.parse(text));
  }
}

const DEFAULT_MODELS = { cli: "claude-opus-5", gemini: "gemini-3.8-flash" } as const;

export function createCoachModel(): CoachModel {
  // `||` not `??`: GitHub Actions passes unset variables as empty strings.
  const backend = process.env.COACH_BACKEND || "cli";
  const model = (name: keyof typeof DEFAULT_MODELS) => process.env.COACH_MODEL || DEFAULT_MODELS[name];
  switch (backend) {
    case "cli":
      return new ClaudeCliModel(model("cli"));
    case "gemini":
      return new GeminiModel(requireEnv("GEMINI_API_KEY"), model("gemini"));
    default:
      throw new Error(`Unknown COACH_BACKEND "${backend}" (supported: cli, gemini)`);
  }
}
