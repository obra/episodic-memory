import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { colors, sansFont, monoFont } from "../styles";

export const ProblemScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  // Session boxes
  const sessions = [
    { label: "Session 1", decisions: ["Use React Query", "API v2 endpoint"], x: 100 },
    { label: "Session 2", decisions: ["Switch to Zustand", "Add caching"], x: 560 },
    { label: "Session 3", decisions: ["Refactor auth flow", "...what was decided?"], x: 1020 },
  ];

  // Gap indicators
  const gap1Opacity = interpolate(frame, [50, 65], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const gap2Opacity = interpolate(frame, [75, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Fade effect for decisions in gaps
  const decisions1Fade = interpolate(frame, [60, 80], [1, 0.15], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const decisions2Fade = interpolate(frame, [85, 105], [1, 0.15], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Question marks appearing
  const questionOpacity = interpolate(frame, [100, 115], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const questionScale = spring({ frame: Math.max(0, frame - 100), fps, config: { damping: 10, stiffness: 100 } });

  // Red warning pulse
  const warningPulse = interpolate(frame, [115, 140], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pulseAlpha = frame > 115 ? 0.05 + 0.03 * Math.sin((frame - 115) * 0.3) : 0;

  return (
    <AbsoluteFill style={{ background: colors.bg, fontFamily: sansFont }}>
      {/* Red pulse overlay */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(circle at 50% 60%, rgba(248,81,73,${pulseAlpha}) 0%, transparent 70%)`,
      }} />

      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 100px" }}>
        <div style={{
          fontSize: 14,
          color: colors.red,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 3,
          opacity: titleOpacity,
          marginBottom: 6,
        }}>
          Problem
        </div>
        <div style={{
          fontSize: 44,
          fontWeight: 700,
          color: colors.text,
          opacity: titleOpacity,
          marginBottom: 50,
        }}>
          Context <span style={{ color: colors.red }}>lost between sessions</span>
        </div>

        {/* Sessions timeline */}
        <div style={{ position: "relative", height: 320 }}>
          {/* Connection line */}
          <div style={{
            position: "absolute",
            top: 60,
            left: 140,
            width: interpolate(frame, [20, 50], [0, 1100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            height: 2,
            background: `linear-gradient(90deg, ${colors.accent}, ${colors.border})`,
          }} />

          {sessions.map((s, i) => {
            const delay = 15 + i * 20;
            const boxOpacity = interpolate(frame, [delay, delay + 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const boxY = interpolate(frame, [delay, delay + 15], [30, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const decisionFade = i === 0 ? decisions1Fade : i === 1 ? decisions2Fade : 1;

            return (
              <div key={i} style={{
                position: "absolute",
                left: s.x,
                top: 0,
                opacity: boxOpacity,
                transform: `translateY(${boxY}px)`,
              }}>
                {/* Session dot */}
                <div style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: i < 2 ? colors.accent : colors.orange,
                  margin: "0 auto 16px",
                  position: "relative",
                  left: 120,
                }}>
                  <div style={{
                    position: "absolute",
                    top: -24,
                    left: -30,
                    width: 80,
                    textAlign: "center",
                    fontSize: 13,
                    fontFamily: monoFont,
                    color: colors.textMuted,
                  }}>
                    {s.label}
                  </div>
                </div>

                {/* Decision cards */}
                <div style={{
                  marginTop: 30,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  width: 280,
                  opacity: decisionFade,
                }}>
                  {s.decisions.map((d, j) => (
                    <div key={j} style={{
                      background: colors.surface,
                      border: `1px solid ${i === 2 && j === 1 ? colors.red : colors.border}`,
                      borderRadius: 8,
                      padding: "10px 14px",
                      fontSize: 15,
                      color: i === 2 && j === 1 ? colors.red : colors.text,
                      fontFamily: monoFont,
                    }}>
                      {d}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Gap indicators */}
          <div style={{
            position: "absolute",
            left: 390,
            top: 35,
            opacity: gap1Opacity,
            fontSize: 28,
            color: colors.red,
            fontWeight: 700,
            letterSpacing: 4,
          }}>
            {"/ / /"}
          </div>
          <div style={{
            position: "absolute",
            left: 850,
            top: 35,
            opacity: gap2Opacity,
            fontSize: 28,
            color: colors.red,
            fontWeight: 700,
            letterSpacing: 4,
          }}>
            {"/ / /"}
          </div>

          {/* Big question mark */}
          <div style={{
            position: "absolute",
            right: 80,
            top: 80,
            fontSize: 120,
            color: colors.red,
            opacity: questionOpacity * warningPulse,
            transform: `scale(${questionScale})`,
            fontWeight: 700,
          }}>
            ?
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
