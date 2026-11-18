"use client";

// Last resort: used only if the root layout itself fails, so it has to bring
// its own <html> and cannot rely on the app's styles.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "3rem 1rem",
          maxWidth: "40rem",
          marginInline: "auto",
        }}
      >
        <h1 style={{ fontSize: "1.5rem" }}>Something went wrong</h1>
        <p style={{ color: "#444" }}>
          Your data is safe. Please try again in a moment.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            border: "1px solid #0b5d63",
            background: "#0b5d63",
            color: "#fff",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
