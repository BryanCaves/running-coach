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

export async function postToDiscord(webhookUrl: string, embeds: Embed[]): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Run Coach",
      embeds: embeds.map((e) => ({
        title: clip(e.title, 256),
        description: clip(e.description, 4096),
        color: COLORS[e.status],
        fields: e.fields
          .slice(0, 25)
          .map((f) => ({ name: clip(f.name, 256), value: clip(f.value, 1024), inline: f.inline ?? false })),
        footer: { text: clip(e.footer, 2048) },
      })),
    }),
  });
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
}
