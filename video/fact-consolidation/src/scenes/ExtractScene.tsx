import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { colors, sansFont, monoFont } from "../styles";

const factCategories = [
  { label: "decision", color: colors.accent, text: "User prefers Zustand over Redux" },
  { label: "preference", color: colors.purple, text: "Always use TypeScript strict mode" },
  { label: "pattern", color: colors.green, text: "Feature-first folder structure" },
  { label: "knowledge", color: colors.orange, text: "API uses v2 with OAuth2" },
  { label: "constraint", color: colors.red, text: "No localStorage usage allowed" },
];

export const ExtractScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  // Conversation bubbles animation
  const bubble1Opacity = interpolate(frame, [15, 25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bubble2Opacity = interpolate(frame, [25, 35], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bubble3Opacity = interpolate(frame, [35, 45], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Arrow from conversation to LLM
  const arrowProgress = interpolate(frame, [50, 70], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // LLM box glow
  const llmGlow = interpolate(frame, [60, 80], [0, 0.4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const llmPulse = frame > 60 ? 0.4 + 0.1 * Math.sin((frame - 60) * 0.2) : 0;

  // Arrow from LLM to facts
  const arrow2Progress = interpolate(frame, [85, 105], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Bottom note
  const noteOpacity = interpolate(frame, [175, 195], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: colors.bg, fontFamily: sansFont }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 80px" }}>
        <div style={{
          fontSize: 14,
          color: colors.green,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 3,
          opacity: titleOpacity,
          marginBottom: 6,
        }}>
          SessionEnd Hook
        </div>
        <div style={{
          fontSize: 44,
          fontWeight: 700,
          color: colors.text,
          opacity: titleOpacity,
          marginBottom: 40,
        }}>
          Automatic <span style={{ color: colors.green }}>Fact Extraction</span>
        </div>

        {/* Three-column layout: Conversation -> LLM -> Facts */}
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          {/* Column 1: Conversation */}
          <div style={{ width: 380, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, color: colors.textMuted, fontFamily: monoFont, marginBottom: 8 }}>
              Session Conversation
            </div>
            {[
              { opacity: bubble1Opacity, text: "Let's use Zustand for state management", isUser: true },
              { opacity: bubble2Opacity, text: "I'll set up the feature-first structure with TypeScript strict mode", isUser: false },
              { opacity: bubble3Opacity, text: "Remember: no localStorage, use Supabase", isUser: true },
            ].map((b, i) => (
              <div key={i} style={{
                opacity: b.opacity,
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 14,
                color: colors.text,
                background: b.isUser ? "rgba(88,166,255,0.1)" : colors.surface,
                border: `1px solid ${b.isUser ? "rgba(88,166,255,0.2)" : colors.border}`,
                alignSelf: b.isUser ? "flex-end" : "flex-start",
                maxWidth: 300,
              }}>
                {b.text}
              </div>
            ))}
          </div>

          {/* Arrow 1 */}
          <div style={{ width: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{
              width: interpolate(arrowProgress, [0, 1], [0, 60]),
              height: 3,
              background: `linear-gradient(90deg, ${colors.accent}, ${colors.green})`,
              borderRadius: 2,
              position: "relative",
            }}>
              {arrowProgress > 0.8 && (
                <div style={{
                  position: "absolute",
                  right: -8,
                  top: -5,
                  width: 0,
                  height: 0,
                  borderTop: "6px solid transparent",
                  borderBottom: "6px solid transparent",
                  borderLeft: `10px solid ${colors.green}`,
                }} />
              )}
            </div>
          </div>

          {/* Column 2: LLM */}
          <div style={{
            width: 200,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}>
            <div style={{
              padding: "24px 28px",
              borderRadius: 16,
              background: colors.surface,
              border: `2px solid ${colors.purple}`,
              boxShadow: `0 0 ${llmGlow * 60}px rgba(210,168,255,${llmPulse})`,
              textAlign: "center",
            }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>{"{ }"}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: colors.purple, fontFamily: monoFont }}>
                Haiku LLM
              </div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
                fact_extraction
              </div>
            </div>
          </div>

          {/* Arrow 2 */}
          <div style={{ width: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{
              width: interpolate(arrow2Progress, [0, 1], [0, 60]),
              height: 3,
              background: `linear-gradient(90deg, ${colors.purple}, ${colors.orange})`,
              borderRadius: 2,
              position: "relative",
            }}>
              {arrow2Progress > 0.8 && (
                <div style={{
                  position: "absolute",
                  right: -8,
                  top: -5,
                  width: 0,
                  height: 0,
                  borderTop: "6px solid transparent",
                  borderBottom: "6px solid transparent",
                  borderLeft: `10px solid ${colors.orange}`,
                }} />
              )}
            </div>
          </div>

          {/* Column 3: Extracted Facts */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 13, color: colors.textMuted, fontFamily: monoFont, marginBottom: 8 }}>
              Extracted Facts
            </div>
            {factCategories.map((fact, i) => {
              const delay = 95 + i * 16;
              const factOpacity = interpolate(frame, [delay, delay + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
              const factX = interpolate(frame, [delay, delay + 12], [30, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
              const badgeScale = spring({ frame: Math.max(0, frame - delay - 5), fps, config: { damping: 12, stiffness: 120 } });

              return (
                <div key={i} style={{
                  opacity: factOpacity,
                  transform: `translateX(${factX}px)`,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderLeft: `3px solid ${fact.color}`,
                  borderRadius: 8,
                  padding: "8px 14px",
                }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: colors.bg,
                    background: fact.color,
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontFamily: monoFont,
                    transform: `scale(${badgeScale})`,
                    display: "inline-block",
                    whiteSpace: "nowrap",
                  }}>
                    {fact.label}
                  </span>
                  <span style={{ fontSize: 14, color: colors.text }}>{fact.text}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom note */}
        <div style={{
          display: "flex",
          gap: 32,
          marginTop: 32,
          opacity: noteOpacity,
          justifyContent: "center",
        }}>
          <div style={{
            fontSize: 15,
            color: colors.textMuted,
            fontFamily: monoFont,
            padding: "8px 16px",
            background: colors.surface2,
            borderRadius: 8,
          }}>
            max <span style={{ color: colors.accent, fontWeight: 700 }}>20</span> facts/session
          </div>
          <div style={{
            fontSize: 15,
            color: colors.textMuted,
            fontFamily: monoFont,
            padding: "8px 16px",
            background: colors.surface2,
            borderRadius: 8,
          }}>
            confidence <span style={{ color: colors.green, fontWeight: 700 }}>{">"} 0.7</span>
          </div>
          <div style={{
            fontSize: 15,
            color: colors.textMuted,
            fontFamily: monoFont,
            padding: "8px 16px",
            background: colors.surface2,
            borderRadius: 8,
          }}>
            5 categories
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
