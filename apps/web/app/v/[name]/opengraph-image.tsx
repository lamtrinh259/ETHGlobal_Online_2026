import { ImageResponse } from "next/og";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { flourish } from "@/lib/patience";
import { questionTitle } from "@/lib/questions";

/**
 * The picture on a link to a name.
 *
 * A subject is the one most people paste anywhere — it is a question anybody may answer, and the
 * question is the whole of what a reader needs to see before they open it. Every other name here is a
 * record rather than an invitation, so it gets its own name and nothing invented on top.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A name on Ketsuban";
export const runtime = "nodejs";

export default async function Image({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeURIComponent((await params).name);
  const config = loadWebConfig();
  const subject = config.instances.find((i) => i.parentName.toLowerCase() === name.toLowerCase());
  const read = subject
    ? await createApi(config.apiUrl, config.attestUrl)
        .instance(subject.domain, { signal: flourish() })
        .catch(() => null)
    : null;
  const answers = read?.answers.length ?? 0;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#060a18",
        color: "#f5f7fb",
        padding: 72,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 30, color: "#8da2c0", letterSpacing: 2 }}>KETSUBAN</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: subject ? 64 : 56, fontWeight: 700, lineHeight: 1.15 }}>
          {subject ? questionTitle(subject.domain) : name}
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#8da2c0", marginTop: 16 }}>{name}</div>
      </div>
      <div style={{ display: "flex", fontSize: 36, color: "#f5f7fb" }}>
        {subject
          ? `${answers} answer${answers === 1 ? "" : "s"}, each signed into a name of its own`
          : "Read through the ENS resolver, not through this app"}
      </div>
    </div>,
    size
  );
}
