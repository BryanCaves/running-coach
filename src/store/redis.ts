import { z } from "zod";

const Reply = z.object({ result: z.unknown().optional(), error: z.string().optional() });

/** Minimal Upstash Redis client over its REST API. */
export class Redis {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async command(...args: (string | number)[]): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(args),
    });
    const reply = Reply.parse(await res.json());
    if (!res.ok || reply.error) throw new Error(`Upstash ${args[0]} failed: ${reply.error ?? res.status}`);
    return reply.result;
  }
}

const POSTED_RUNS = "runs:posted";

/** Tracks which runs already got a post-run message. */
export class RunLog {
  constructor(private readonly redis: Redis) {}

  async isEmpty(): Promise<boolean> {
    return (await this.redis.command("SCARD", POSTED_RUNS)) === 0;
  }

  async posted(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const flags = z.array(z.number()).parse(await this.redis.command("SMISMEMBER", POSTED_RUNS, ...ids));
    return new Set(ids.filter((_, i) => flags[i] === 1));
  }

  async markPosted(...ids: string[]): Promise<void> {
    if (ids.length) await this.redis.command("SADD", POSTED_RUNS, ...ids);
  }
}
