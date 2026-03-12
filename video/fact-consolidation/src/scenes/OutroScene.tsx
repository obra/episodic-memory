import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { colors, sansFont, monoFont } from "../styles";

export const OutroScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bgGlow = interpolate(frame, [0, 60], [0, 0.18], { extrapolateRight: "clamp" });

  const taglineOpacity = interpolate(frame, [5, 20], [0, 1], { extrapolateRight: "clamp" });
  const taglineScale = spring({ frame: Math.max(0, frame - 5), fps, config: { damping: 14, stiffness: 80 } });

  const stats = [
    { label: "5 categories", color: colors.accent },
    { label: "Project isolation", color: colors.purple },
    { label: "Revision history", color: colors.green },
    { label: "Vector search", color: colors.orange },
  ];

  const linkOpacity = interpolate(frame, [65, 80], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Fade out at end
  const fadeOut = interpolate(frame, [100, 120], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{
      background: `radial-gradient(circle at 50% 40%, rgba(210,168,255,${bgGlow}) 0%, ${colors.bg} 70%)`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      fontFamily: sansFont,
      opacity: fadeOut,
    }}>
      {/* Tagline */}
      <div style={{
        fontSize: 52,
        fontWeight: 700,
        color: colors.text,
        opacity: taglineOpacity,
        transform: `scale(${taglineScale})`,
        marginBottom: 40,
      }}>
        Every session gets <span style={{ color: colors.purple }}>smarter</span>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 20, marginBottom: 50 }}>
        {stats.map((s, i) => {
          const delay = 20 + i * 10;
          const statOpacity = interpolate(frame, [delay, delay + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const statScale = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 12, stiffness: 120 } });

          return (
            <div key={i} style={{
              opacity: statOpacity,
              transform: `scale(${statScale})`,
              padding: "12px 24px",
              background: `${s.color}10`,
              border: `1px solid ${s.color}40`,
              borderRadius: 10,
              fontSize: 18,
              fontWeight: 600,
              color: s.color,
            }}>
              {s.label}
            </div>
          );
        })}
      </div>

      {/* GitHub link */}
      <div style={{
        opacity: linkOpacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}>
        <div style={{
          fontSize: 20,
          fontFamily: monoFont,
          color: colors.accent,
          padding: "12px 32px",
          background: colors.surface,
          border: `1px solid ${colors.accent}40`,
          borderRadius: 12,
        }}>
          github.com/jung-wan-kim/episodic-memory
        </div>
        <div style={{
          fontSize: 14,
          color: colors.textMuted,
          fontFamily: monoFont,
        }}>
          Claude Code Plugin
        </div>
      </div>
    </AbsoluteFill>
  );
};
