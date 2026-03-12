import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { colors, sansFont, monoFont } from "../styles";

const outcomes = [
  {
    label: "DUPLICATE",
    action: "merge",
    icon: "=",
    color: colors.accent,
    desc: "Same fact found twice",
    detail: "count++ (seen 3x)",
    oldFact: "Use TypeScript strict",
    newFact: "Use TypeScript strict",
  },
  {
    label: "CONTRADICTION",
    action: "replace",
    icon: "!",
    color: colors.red,
    desc: "New fact overrides old",
    detail: "old archived in revision",
    oldFact: "Use Redux",
    newFact: "Use Zustand instead",
  },
  {
    label: "EVOLUTION",
    action: "update",
    icon: "+",
    color: colors.orange,
    desc: "Fact grows or refines",
    detail: "content merged",
    oldFact: "API uses REST",
    newFact: "API uses REST v2 + OAuth2",
  },
  {
    label: "INDEPENDENT",
    action: "keep both",
    icon: "||",
    color: colors.green,
    desc: "Completely different topic",
    detail: "both stored separately",
    oldFact: "Deploy to Vercel",
    newFact: "Use feature-first structure",
  },
];

export const ConsolidateScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  // Vector similarity animation
  const vectorPhaseEnd = 60;
  const node1X = interpolate(frame, [15, 40], [300, 500], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const node2X = interpolate(frame, [15, 40], [1300, 1100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const nodeOpacity = interpolate(frame, [15, 25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const connectionOpacity = interpolate(frame, [35, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const matchLabel = interpolate(frame, [45, 55], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Similarity score counting up
  const similarityScore = interpolate(frame, [40, 55], [0, 0.92], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Transition to outcomes
  const vectorFadeOut = interpolate(frame, [55, 65], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Outcomes subtitle
  const outcomesTitle = interpolate(frame, [65, 80], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: colors.bg, fontFamily: sansFont }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 80px" }}>
        <div style={{
          fontSize: 14,
          color: colors.purple,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 3,
          opacity: titleOpacity,
          marginBottom: 6,
        }}>
          SessionStart Hook
        </div>
        <div style={{
          fontSize: 44,
          fontWeight: 700,
          color: colors.text,
          opacity: titleOpacity,
          marginBottom: 30,
        }}>
          Smart <span style={{ color: colors.purple }}>Consolidation</span>
        </div>

        {/* Vector similarity matching (fades out) */}
        {frame < 70 && (
          <div style={{
            position: "relative",
            height: 100,
            marginBottom: 20,
            opacity: vectorFadeOut,
          }}>
            {/* Existing fact node */}
            <div style={{
              position: "absolute",
              left: node1X - 100,
              top: 20,
              opacity: nodeOpacity,
            }}>
              <div style={{
                padding: "12px 20px",
                borderRadius: 12,
                background: colors.surface,
                border: `1px solid ${colors.accent}`,
                fontSize: 14,
                color: colors.text,
                fontFamily: monoFont,
              }}>
                existing fact vector
              </div>
            </div>

            {/* Connection line */}
            <div style={{
              position: "absolute",
              left: node1X + 100,
              top: 37,
              width: node2X - node1X - 200,
              height: 2,
              opacity: connectionOpacity,
              background: `linear-gradient(90deg, ${colors.accent}, ${colors.purple})`,
            }}>
              {/* Similarity score */}
              <div style={{
                position: "absolute",
                top: -28,
                left: "50%",
                transform: "translateX(-50%)",
                fontSize: 18,
                fontWeight: 700,
                color: colors.green,
                fontFamily: monoFont,
                opacity: matchLabel,
              }}>
                similarity: {similarityScore.toFixed(2)}
              </div>
            </div>

            {/* New fact node */}
            <div style={{
              position: "absolute",
              left: node2X - 100,
              top: 20,
              opacity: nodeOpacity,
            }}>
              <div style={{
                padding: "12px 20px",
                borderRadius: 12,
                background: colors.surface,
                border: `1px solid ${colors.purple}`,
                fontSize: 14,
                color: colors.text,
                fontFamily: monoFont,
              }}>
                new fact vector
              </div>
            </div>
          </div>
        )}

        {/* Four outcomes subtitle */}
        <div style={{
          fontSize: 20,
          color: colors.textMuted,
          opacity: outcomesTitle,
          marginBottom: 20,
          fontWeight: 500,
        }}>
          4 possible outcomes:
        </div>

        {/* Four outcomes grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {outcomes.map((o, i) => {
            const delay = 75 + i * 22;
            const itemOpacity = interpolate(frame, [delay, delay + 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const itemScale = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 14, stiffness: 100 } });

            // Old fact strike-through for CONTRADICTION
            const strikeWidth = o.label === "CONTRADICTION"
              ? interpolate(frame, [delay + 15, delay + 25], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
              : 0;

            // Evolution transform glow
            const evolGlow = o.label === "EVOLUTION"
              ? interpolate(frame, [delay + 10, delay + 25], [0, 0.3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
              : 0;

            // Duplicate count animation
            const dupCount = o.label === "DUPLICATE"
              ? Math.floor(interpolate(frame, [delay + 10, delay + 25], [1, 3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }))
              : 0;

            return (
              <div key={i} style={{
                opacity: itemOpacity,
                transform: `scale(${itemScale})`,
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: "18px 22px",
                position: "relative",
                overflow: "hidden",
              }}>
                {/* Top label */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: `${o.color}20`,
                    border: `1px solid ${o.color}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    fontWeight: 700,
                    color: o.color,
                    fontFamily: monoFont,
                  }}>
                    {o.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: o.color, fontFamily: monoFont }}>{o.label}</div>
                    <div style={{ fontSize: 12, color: colors.textMuted }}>{o.desc}</div>
                  </div>
                  <div style={{
                    marginLeft: "auto",
                    fontSize: 12,
                    color: colors.bg,
                    background: o.color,
                    padding: "2px 10px",
                    borderRadius: 4,
                    fontWeight: 700,
                    fontFamily: monoFont,
                  }}>
                    {o.action}
                  </div>
                </div>

                {/* Fact cards */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{
                    fontSize: 13,
                    fontFamily: monoFont,
                    color: o.label === "CONTRADICTION" ? colors.textMuted : colors.text,
                    padding: "6px 10px",
                    background: colors.surface2,
                    borderRadius: 6,
                    position: "relative",
                    textDecoration: o.label === "CONTRADICTION" ? "line-through" : "none",
                  }}>
                    {o.label === "CONTRADICTION" && (
                      <div style={{
                        position: "absolute",
                        top: "50%",
                        left: 0,
                        width: `${strikeWidth}%`,
                        height: 2,
                        background: colors.red,
                      }} />
                    )}
                    old: {o.oldFact}
                    {o.label === "DUPLICATE" && (
                      <span style={{ color: colors.accent, marginLeft: 8, fontWeight: 700 }}>x{dupCount}</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 13,
                    fontFamily: monoFont,
                    color: colors.text,
                    padding: "6px 10px",
                    background: `${o.color}10`,
                    border: `1px solid ${o.color}40`,
                    borderRadius: 6,
                    boxShadow: evolGlow > 0 ? `0 0 ${evolGlow * 20}px ${o.color}40` : "none",
                  }}>
                    new: {o.newFact}
                  </div>
                </div>

                {/* Detail */}
                <div style={{
                  fontSize: 11,
                  color: colors.textMuted,
                  fontFamily: monoFont,
                  marginTop: 8,
                }}>
                  {o.detail}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
