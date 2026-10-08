import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const alt = "AI 課表助手預覽圖";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const days = [
  { label: "週一", blocks: [{ name: "微積分", color: "#4f46e5", flex: 1.4 }] },
  { label: "週二", blocks: [{ name: "資料結構", color: "#7c3aed", flex: 1 }] },
  { label: "週三", blocks: [{ name: "線性代數", color: "#d97706", flex: 1.15 }] },
  { label: "週四", blocks: [{ name: "微積分", color: "#059669", flex: 0.9 }] },
  { label: "週五", blocks: [{ name: "資料結構", color: "#0284c7", flex: 1.05 }] },
];

async function loadFonts() {
  const dir = path.join(process.cwd(), "app/fonts");
  const [regular, bold] = await Promise.all([
    readFile(path.join(dir, "NotoSansTC-500.ttf")),
    readFile(path.join(dir, "NotoSansTC-700.ttf")),
  ]);
  return [
    { name: "Noto Sans TC", data: regular, weight: 500 as const, style: "normal" as const },
    { name: "Noto Sans TC", data: bold, weight: 700 as const, style: "normal" as const },
  ];
}

export default async function OpenGraphImage() {
  const fonts = await loadFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundImage: "linear-gradient(135deg, #1e1b4b 0%, #4338ca 58%, #6d28d9 100%)",
          color: "white",
          fontFamily: "Noto Sans TC",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -120,
            left: 420,
            width: 420,
            height: 420,
            borderRadius: 999,
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 70%)",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: 620,
            padding: "64px 24px 64px 72px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              alignSelf: "flex-start",
              backgroundColor: "rgba(255,255,255,0.14)",
              border: "1px solid rgba(255,255,255,0.22)",
              borderRadius: 999,
              padding: "8px 16px",
              fontSize: 22,
              fontWeight: 500,
            }}
          >
            Course Copilot
          </div>
          <div style={{ display: "flex", marginTop: 28, fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>
            AI 課表助手
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 18,
              fontSize: 32,
              fontWeight: 500,
              lineHeight: 1.35,
              color: "#e0e7ff",
            }}
          >
            <div style={{ display: "flex" }}>截圖 1 秒匯入</div>
            <div style={{ display: "flex" }}>iPhone / Google 日曆</div>
          </div>
          <div style={{ display: "flex", marginTop: 32, gap: 12 }}>
            {["上傳截圖", "AI 辨識", "匯出 .ics"].map((label) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  backgroundColor: "rgba(15,23,42,0.28)",
                  borderRadius: 999,
                  padding: "10px 16px",
                  fontSize: 22,
                  fontWeight: 500,
                }}
              >
                {label}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", marginTop: 36, fontSize: 22, color: "#c7d2fe" }}>
            ics.necterelux.com
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 56,
            top: 42,
            width: 430,
            height: 390,
            display: "flex",
            flexDirection: "column",
            backgroundColor: "white",
            color: "#1e1b4b",
            borderRadius: 28,
            padding: 22,
            transform: "rotate(-7deg)",
            boxShadow: "0 28px 50px rgba(15, 23, 42, 0.35)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700 }}>本週課表</div>
            <div style={{ display: "flex", fontSize: 16, color: "#6366f1", fontWeight: 500 }}>週一 - 週五</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18, height: 300 }}>
            {days.map((day) => (
              <div key={day.label} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    fontSize: 16,
                    fontWeight: 700,
                    color: "#4338ca",
                    marginBottom: 8,
                  }}
                >
                  {day.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8 }}>
                  {day.blocks.map((block) => (
                    <div
                      key={block.name}
                      style={{
                        display: "flex",
                        flex: block.flex,
                        backgroundColor: block.color,
                        color: "white",
                        borderRadius: 12,
                        padding: "8px 4px",
                        fontSize: 14,
                        fontWeight: 700,
                      }}
                    >
                      {block.name}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 36,
            bottom: 28,
            width: 460,
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#ffffff",
            color: "#1c1917",
            borderRadius: 24,
            padding: 20,
            transform: "rotate(5deg)",
            boxShadow: "0 24px 48px rgba(15, 23, 42, 0.4)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 54,
                height: 54,
                borderRadius: 14,
                backgroundColor: "#4f46e5",
                color: "white",
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              .ics
            </div>
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 14 }}>
              <div style={{ display: "flex", fontSize: 22, fontWeight: 700 }}>course-schedule.ics</div>
              <div style={{ display: "flex", marginTop: 4, fontSize: 16, color: "#78716c" }}>
                Apple 行事曆 / Google 日曆
              </div>
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 16, gap: 10 }}>
            <div
              style={{
                display: "flex",
                flex: 1,
                justifyContent: "center",
                backgroundColor: "#111827",
                color: "white",
                borderRadius: 999,
                padding: "10px 12px",
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              Apple 行事曆
            </div>
            <div
              style={{
                display: "flex",
                flex: 1,
                justifyContent: "center",
                backgroundColor: "#eef2ff",
                color: "#3730a3",
                borderRadius: 999,
                padding: "10px 12px",
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              Google 日曆
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
