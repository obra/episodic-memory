import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { colors, sansFont, monoFont } from "../styles";

export const ScopeScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  // Global box appears first
  const globalOpacity = interpolate(frame, [15, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const globalScale = spring({ frame: Math.max(0, frame - 15), fps, config: { damping: 14 } });

  // Project boxes
  const projAOpacity = interpolate(frame, [35, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const projBOpacity = interpolate(frame, [45, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const projAScale = spring({ frame: Math.max(0, frame - 35), fps, config: { damping: 14 } });
  const projBScale = spring({ frame: Math.max(0, frame - 45), fps, config: { damping: 14 } });

  // Connection lines (global to projects)
  const lineOpacity = interpolate(frame, [55, 70], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Red X between projects
  const xOpacity = interpolate(frame, [75, 85], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const xScale = spring({ frame: Math.max(0, frame - 75), fps, config: { damping: 10, stiffness: 150 } });

  // Green checks
  const checkOpacity = interpolate(frame, [90, 100], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const checkScale = spring({ frame: Math.max(0, frame - 90), fps, config: { damping: 12, stiffness: 120 } });

  // Bottom explanation
  const explainOpacity = interpolate(frame, [105, 120], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const globalFacts = [
    { text: "User prefers TypeScript", color: colors.accent },
    { text: "Always run tests", color: colors.green },
  ];
  const projAFacts = [
    { text: "Use Next.js 15", color: colors.purple },
    { text: "Deploy to Vercel", color: colors.accent },
  ];
  const projBFacts = [
    { text: "Flutter + Riverpod", color: colors.orange },
    { text: "Firebase backend", color: colors.red },
  ];

  const FactCard = ({ text, color, delay }: { text: string; color: string; delay: number }) => {
    const cardOpacity = interpolate(frame, [delay, delay + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return (
      <div style={{
        opacity: cardOpacity,
        fontSize: 13,
        fontFamily: monoFont,
        color: colors.text,
        padding: "6px 12px",
        background: `${color}10`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 4,
      }}>
        {text}
      </div>
    );
  };

  return (
    <AbsoluteFill style={{ background: colors.bg, fontFamily: sansFont }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 100px" }}>
        <div style={{
          fontSize: 14,
          color: colors.accent,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 3,
          opacity: titleOpacity,
          marginBottom: 6,
        }}>
          Architecture
        </div>
        <div style={{
          fontSize: 44,
          fontWeight: 700,
          color: colors.text,
          opacity: titleOpacity,
          marginBottom: 50,
        }}>
          Scope <span style={{ color: colors.accent }}>Isolation</span>
        </div>

        <div style={{ position: "relative", height: 500 }}>
          {/* Global scope box - top center */}
          <div style={{
            position: "absolute",
            left: "50%",
            top: 0,
            transform: `translateX(-50%) scale(${globalScale})`,
            opacity: globalOpacity,
            width: 500,
          }}>
            <div style={{
              background: colors.surface,
              border: `2px solid ${colors.accent}`,
              borderRadius: 16,
              padding: "20px 28px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: colors.accent, marginBottom: 12 }}>
                GLOBAL SCOPE
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {globalFacts.map((f, i) => (
                  <FactCard key={i} text={f.text} color={f.color} delay={25 + i * 8} />
                ))}
              </div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 8, fontFamily: monoFont }}>
                Shared across all projects
              </div>
            </div>
          </div>

          {/* Connection lines */}
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {/* Global to Project A */}
            <line
              x1="45%" y1="155" x2="28%" y2="240"
              stroke={colors.green}
              strokeWidth={2}
              strokeDasharray="6,4"
              opacity={lineOpacity}
            />
            {/* Global to Project B */}
            <line
              x1="55%" y1="155" x2="72%" y2="240"
              stroke={colors.green}
              strokeWidth={2}
              strokeDasharray="6,4"
              opacity={lineOpacity}
            />
          </svg>

          {/* Green checks on lines */}
          <div style={{
            position: "absolute",
            left: "33%",
            top: 185,
            opacity: checkOpacity,
            transform: `scale(${checkScale})`,
            fontSize: 24,
            color: colors.green,
            fontWeight: 700,
            background: colors.bg,
            padding: "2px 6px",
            borderRadius: 6,
          }}>
            OK
          </div>
          <div style={{
            position: "absolute",
            left: "63%",
            top: 185,
            opacity: checkOpacity,
            transform: `scale(${checkScale})`,
            fontSize: 24,
            color: colors.green,
            fontWeight: 700,
            background: colors.bg,
            padding: "2px 6px",
            borderRadius: 6,
          }}>
            OK
          </div>

          {/* Project A box - bottom left */}
          <div style={{
            position: "absolute",
            left: 60,
            top: 240,
            opacity: projAOpacity,
            transform: `scale(${projAScale})`,
            width: 420,
          }}>
            <div style={{
              background: colors.surface,
              border: `2px solid ${colors.purple}`,
              borderRadius: 16,
              padding: "20px 28px",
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: colors.purple, marginBottom: 12 }}>
                PROJECT A: web-app
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {projAFacts.map((f, i) => (
                  <FactCard key={i} text={f.text} color={f.color} delay={45 + i * 8} />
                ))}
              </div>
            </div>
          </div>

          {/* Project B box - bottom right */}
          <div style={{
            position: "absolute",
            right: 60,
            top: 240,
            opacity: projBOpacity,
            transform: `scale(${projBScale})`,
            width: 420,
          }}>
            <div style={{
              background: colors.surface,
              border: `2px solid ${colors.orange}`,
              borderRadius: 16,
              padding: "20px 28px",
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: colors.orange, marginBottom: 12 }}>
                PROJECT B: mobile-app
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {projBFacts.map((f, i) => (
                  <FactCard key={i} text={f.text} color={f.color} delay={55 + i * 8} />
                ))}
              </div>
            </div>
          </div>

          {/* Red X between projects */}
          <div style={{
            position: "absolute",
            left: "50%",
            top: 310,
            transform: `translateX(-50%) scale(${xScale})`,
            opacity: xOpacity,
          }}>
            <div style={{
              background: `${colors.red}20`,
              border: `2px solid ${colors.red}`,
              borderRadius: 12,
              padding: "8px 16px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span style={{ fontSize: 24, color: colors.red, fontWeight: 700 }}>X</span>
              <span style={{ fontSize: 14, color: colors.red, fontFamily: monoFont }}>no cross-leak</span>
            </div>
          </div>

          {/* Dashed line between projects showing blocked */}
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            <line
              x1="32%" y1="340" x2="68%" y2="340"
              stroke={colors.red}
              strokeWidth={2}
              strokeDasharray="4,8"
              opacity={xOpacity * 0.5}
            />
          </svg>
        </div>

        {/* Bottom explanation */}
        <div style={{
          display: "flex",
          gap: 40,
          opacity: explainOpacity,
          justifyContent: "center",
          marginTop: -40,
        }}>
          <div style={{
            fontSize: 15,
            color: colors.textMuted,
            fontFamily: monoFont,
            padding: "8px 16px",
            background: colors.surface2,
            borderRadius: 8,
          }}>
            scope: <span style={{ color: colors.accent }}>project</span> | <span style={{ color: colors.green }}>global</span>
          </div>
          <div style={{
            fontSize: 15,
            color: colors.textMuted,
            fontFamily: monoFont,
            padding: "8px 16px",
            background: colors.surface2,
            borderRadius: 8,
          }}>
            project facts <span style={{ color: colors.red }}>never</span> leak to other projects
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
