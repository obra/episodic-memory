import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { colors, sansFont, monoFont } from "../styles";

export const IntroScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const tagOpacity = interpolate(frame, [5, 20], [0, 1], { extrapolateRight: "clamp" });
  const titleScale = spring({ frame: Math.max(0, frame - 10), fps, config: { damping: 14, stiffness: 80 } });
  const lineWidth = interpolate(frame, [20, 60], [0, 700], { extrapolateRight: "clamp" });
  const subtitleOpacity = interpolate(frame, [40, 58], [0, 1], { extrapolateRight: "clamp" });
  const badgesOpacity = interpolate(frame, [58, 76], [0, 1], { extrapolateRight: "clamp" });
  const dateOpacity = interpolate(frame, [75, 90], [0, 1], { extrapolateRight: "clamp" });
  const bgGlow = interpolate(frame, [0, 105], [0, 0.15], { extrapolateRight: "clamp" });

  // Typing effect for subtitle
  const fullText = "Fact Extraction & Consolidation";
  const charsShown = Math.floor(interpolate(frame, [40, 80], [0, fullText.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const typedText = fullText.slice(0, charsShown);
  const cursorOpacity = frame > 40 && frame < 90 ? (Math.floor(frame / 8) % 2 === 0 ? 1 : 0) : 0;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, rgba(88,166,255,${bgGlow}) 0%, ${colors.bg} 70%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        fontFamily: sansFont,
      }}
    >
      <div style={{
        fontSize: 14,
        color: colors.accent,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 4,
        opacity: tagOpacity,
        marginBottom: 16,
        fontFamily: monoFont,
      }}>
        claude code plugin
      </div>

      <div style={{
        fontSize: 78,
        fontWeight: 700,
        color: colors.text,
        transform: `scale(${titleScale})`,
        letterSpacing: -2,
      }}>
        <span style={{ color: colors.purple }}>Episodic</span> Memory
      </div>

      <div style={{
        width: lineWidth,
        height: 2,
        background: `linear-gradient(90deg, transparent, ${colors.purple}, ${colors.accent}, transparent)`,
        marginTop: 28,
        marginBottom: 28,
        borderRadius: 2,
      }} />

      <div style={{
        fontSize: 32,
        color: colors.accent,
        opacity: subtitleOpacity,
        fontWeight: 500,
        height: 40,
      }}>
        {typedText}
        <span style={{ opacity: cursorOpacity, color: colors.accent }}>|</span>
      </div>

      <div style={{ display: "flex", gap: 24, marginTop: 24, opacity: badgesOpacity }}>
        <div style={{
          fontSize: 16,
          color: colors.green,
          padding: "8px 20px",
          background: "rgba(63,185,80,0.08)",
          border: "1px solid rgba(63,185,80,0.2)",
          borderRadius: 8,
        }}>
          Auto-extract from sessions
        </div>
        <div style={{
          fontSize: 16,
          color: colors.purple,
          padding: "8px 20px",
          background: "rgba(210,168,255,0.08)",
          border: "1px solid rgba(210,168,255,0.2)",
          borderRadius: 8,
        }}>
          Smart deduplication
        </div>
        <div style={{
          fontSize: 16,
          color: colors.orange,
          padding: "8px 20px",
          background: "rgba(240,136,62,0.08)",
          border: "1px solid rgba(240,136,62,0.2)",
          borderRadius: 8,
        }}>
          MCP-powered search
        </div>
      </div>

      <div style={{
        fontSize: 16,
        color: colors.textMuted,
        opacity: dateOpacity,
        marginTop: 24,
        fontFamily: monoFont,
      }}>
        2026-03-12
      </div>
    </AbsoluteFill>
  );
};
