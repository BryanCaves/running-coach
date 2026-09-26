import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GeminiModel } from "../src/coach/model.ts";

const schema = z.object({ insight: z.string(), action: z.string() });

function mockFetch(body: unknown, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("GeminiModel", () => {
  it("sends the system prompt and JSON schema, and validates the reply", async () => {
    const fetch = mockFetch({
      candidates: [{ content: { parts: [{ text: '{"insight":"Too hard","action":"Slow down"}' }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await new GeminiModel("key", "gemini-test").generate({ system: "coach", prompt: "run data", schema });

    expect(out).toEqual({ insight: "Too hard", action: "Slow down" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/models/gemini-test:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("key");
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("coach");
    expect(body.generationConfig.responseJsonSchema.required).toEqual(["insight", "action"]);
    expect(body.generationConfig.responseJsonSchema).not.toHaveProperty("$schema");
  });

  it("explains blocked or empty responses", async () => {
    mockFetch({ promptFeedback: { blockReason: "SAFETY" } });
    await expect(new GeminiModel("key", "m").generate({ system: "", prompt: "", schema })).rejects.toThrow(/SAFETY/);
  });

  it("rejects replies that don't match the schema", async () => {
    mockFetch({ candidates: [{ content: { parts: [{ text: '{"insight":"x"}' }] } }] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(new GeminiModel("key", "m").generate({ system: "", prompt: "", schema })).rejects.toThrow();
  });
});
