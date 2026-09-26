export type Status = "on_track" | "watch" | "back_off";

const COLORS: Record<Status, number> = {
  on_track: 0x2ecc71, // green
  watch: 0xf1c40f, // amber
  back_off: 0xe74c3c, // red
};

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title: string;
  description: string;
  status: Status;
  fields: EmbedField[];
  footer: string;
}

// Discord embed limits.
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

// Discord rejects a message whose embeds total more than 6000 characters.
const MAX_MESSAGE_CHARS = 6000;

function toDiscord(e: Embed) {
  return {
    title: clip(e.title, 256),
    description: clip(e.description, 4096),
    color: COLORS[e.status],
    fields: e.fields
      .slice(0, 25)
      .map((f) => ({ name: clip(f.name, 256), value: clip(f.value, 1024), inline: f.inline ?? false })),
    footer: { text: clip(e.footer, 2048) },
  };
}

function size(e: ReturnType<typeof toDiscord>): number {
  return e.title.length + e.description.length + e.footer.text.length +
    e.fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
}

/** Posts embeds as one message, or one message per embed if together they exceed Discord's limit. */
export async function postToDiscord(webhookUrl: string, embeds: Embed[]): Promise<void> {
  const payload = embeds.map(toDiscord);
  const total = payload.reduce((sum, e) => sum + size(e), 0);
  const messages = total <= MAX_MESSAGE_CHARS ? [payload] : payload.map((e) => [e]);
  for (const batch of messages) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Run Coach", embeds: batch }),
    });
    if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
  }
}
