import { ImageResponse } from "next/og";

// The picture shown when a link to the site is shared. Drawn here, no outside
// image or font files.
export const alt = "Shortlist: three introductions a week, not three hundred";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const bar = (width: number) => (
    <div
      style={{
        width,
        height: 36,
        borderRadius: 18,
        background: "#ffffff",
        marginBottom: 28,
      }}
    />
  );
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        background: "#0b5d63",
        color: "#ffffff",
        padding: 80,
      }}
    >
      <div
        style={{ display: "flex", flexDirection: "column", marginRight: 80 }}
      >
        {bar(220)}
        {bar(170)}
        {bar(120)}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 84, fontWeight: 700 }}>Shortlist</div>
        <div style={{ fontSize: 44, marginTop: 16, maxWidth: 700 }}>
          Three introductions a week. Not three hundred.
        </div>
        <div style={{ fontSize: 28, marginTop: 28, opacity: 0.85 }}>
          For people verified through eLitmus
        </div>
      </div>
    </div>,
    size,
  );
}
