import { ImageResponse } from "next/og";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { flourish } from "@/lib/patience";

/**
 * The picture on a link to somebody.
 *
 * The card said the right words and carried no image, so a reference pasted into a message rendered as
 * a line of grey text beside a favicon. What it is worth saying is the same thing the page leads with:
 * whose name this is, and how many people have put their own behind it.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A vouch page on ShibbolETH";
export const runtime = "nodejs";

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const config = loadWebConfig();
  const root = config.instances[0];
  const standing = await createApi(config.apiUrl, config.attestUrl)
    .standing(handle, { signal: flourish() })
    .catch(() => null);
  const references = standing?.received ?? 0;
  // One sentence built in one place, as on the card for a name.
  const written = `${references} ${references === 1 ? "vouch" : "vouches"} written by name, on chain`;

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
        <div style={{ display: "flex", fontSize: 84, fontWeight: 700 }}>{handle}</div>
        <div style={{ display: "flex", fontSize: 34, color: "#8da2c0", marginTop: 8 }}>
          {root ? `${handle}.${root.parentName}` : handle}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 40, color: "#f5f7fb" }}>
        {standing
          ? `${references} vouch${references === 1 ? "" : "es"} written by name, on chain`
          : "Vouches written by name, on chain"}
      </div>
    </div>,
    size
  );
}
