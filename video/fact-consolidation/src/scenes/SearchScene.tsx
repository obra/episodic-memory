import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { colors, sansFont, monoFont } from "../styles";

export const SearchScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  // Terminal header
  const termOpacity = interpolate(frame, [10, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Typing the query
  const queryText = 'search_facts({ query: "state management", scope: "project" })';
  const queryChars = Math.floor(interpolate(frame, [20, 55], [0, queryText.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const typedQuery = queryText.slice(0, queryChars);
  const cursorBlink = Math.floor(frame / 8) % 2 === 0;

  // "Searching..." indicator
  const searchingOpacity = interpolate(frame, [56, 62], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const searchDots = ".".repeat(Math.max(0, Math.floor(((frame - 56) / 6) % 4)));

  // Results appearing
  const results = [
    { category: "decision", similarity: 0.95, text: "Use Zustand over Redux for state management", revisions: 2, color: colors.accent },
    { category: "preference", similarity: 0.88, text: "Prefer React Query for server state", revisions: 1, color: colors.purple },
    { category: "pattern", similarity: 0.82, text: "Feature-first folder structure with co-located state", revisions: 3, color: colors.green },
    { category: "knowledge", similarity: 0.76, text: "Zustand supports middleware for persistence", revisions: 0, color: colors.orange },
  ];

  // Revision history popup
  const revisionOpacity = interpolate(frame, [125, 140], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: colors.bg, fontFamily: sansFont }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 100px" }}>
        <div style={{
          fontSize: 14,
          color: colors.orange,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 3,
          opacity: titleOpacity,
          marginBottom: 6,
        }}>
          MCP Tool
        </div>
        <div style={{
          fontSize: 44,
          fontWeight: 700,
          color: colors.text,
          opacity: titleOpacity,
          marginBottom: 30,
        }}>
          <span style={{ fontFamily: monoFont, color: colors.orange }}>search_facts</span> Interface
        </div>

        {/* Terminal window */}
        <div style={{
          opacity: termOpacity,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          overflow: "hidden",
        }}>
          {/* Terminal header bar */}
          <div style={{
            background: colors.surface2,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: colors.red }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: colors.yellow }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: colors.green }} />
            <span style={{ fontSize: 13, color: colors.textMuted, marginLeft: 12, fontFamily: monoFont }}>
              episodic-memory MCP
            </span>
          </div>

          {/* Terminal body */}
          <div style={{ padding: "20px 24px" }}>
            {/* Query line */}
            <div style={{ fontFamily: monoFont, fontSize: 16, marginBottom: 16 }}>
              <span style={{ color: colors.green }}>{">"}</span>
              <span style={{ color: colors.text, marginLeft: 8 }}>{typedQuery}</span>
              {frame < 60 && <span style={{ color: colors.accent, opacity: cursorBlink ? 1 : 0 }}>|</span>}
            </div>

            {/* Searching indicator */}
            {frame >= 56 && frame < 75 && (
              <div style={{
                fontFamily: monoFont,
                fontSize: 14,
                color: colors.textMuted,
                opacity: searchingOpacity,
                marginBottom: 12,
              }}>
                Searching vector database{searchDots}
              </div>
            )}

            {/* Results */}
            {frame >= 70 && (
              <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
                <div style={{
                  fontSize: 13,
                  color: colors.textMuted,
                  fontFamily: monoFont,
                  marginBottom: 12,
                }}>
                  Found 4 matching facts:
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {results.map((r, i) => {
                    const delay = 75 + i * 14;
                    const resultOpacity = interpolate(frame, [delay, delay + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                    const resultX = interpolate(frame, [delay, delay + 10], [20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

                    // Similarity bar width
                    const barWidth = interpolate(frame, [delay + 5, delay + 15], [0, r.similarity * 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

                    return (
                      <div key={i} style={{
                        opacity: resultOpacity,
                        transform: `translateX(${resultX}px)`,
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "10px 14px",
                        background: colors.surface2,
                        borderRadius: 8,
                        borderLeft: `3px solid ${r.color}`,
                      }}>
                        {/* Category badge */}
                        <span style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: colors.bg,
                          background: r.color,
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontFamily: monoFont,
                          whiteSpace: "nowrap",
                          width: 80,
                          textAlign: "center",
                        }}>
                          {r.category}
                        </span>

                        {/* Fact text */}
                        <span style={{ fontSize: 14, color: colors.text, flex: 1 }}>
                          {r.text}
                        </span>

                        {/* Similarity bar */}
                        <div style={{ width: 120, display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
                          <span style={{ fontSize: 12, fontFamily: monoFont, color: r.similarity > 0.9 ? colors.green : colors.textMuted }}>
                            {r.similarity.toFixed(2)}
                          </span>
                          <div style={{ width: "100%", height: 4, background: colors.border, borderRadius: 2 }}>
                            <div style={{
                              width: `${barWidth}%`,
                              height: "100%",
                              background: r.color,
                              borderRadius: 2,
                            }} />
                          </div>
                        </div>

                        {/* Revision count */}
                        {r.revisions > 0 && (
                          <span style={{
                            fontSize: 11,
                            color: colors.textMuted,
                            fontFamily: monoFont,
                            padding: "2px 6px",
                            background: `${colors.accent}15`,
                            borderRadius: 4,
                          }}>
                            {r.revisions} rev
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Revision history detail */}
            {frame >= 125 && (
              <div style={{
                opacity: revisionOpacity,
                marginTop: 16,
                padding: "12px 16px",
                background: `${colors.accent}08`,
                border: `1px solid ${colors.accent}30`,
                borderRadius: 8,
              }}>
                <div style={{ fontSize: 12, fontFamily: monoFont, color: colors.accent, marginBottom: 8 }}>
                  revision_history (fact #1):
                </div>
                <div style={{ fontSize: 12, fontFamily: monoFont, color: colors.textMuted, lineHeight: 1.6 }}>
                  <div>v1: "Consider Redux for state" <span style={{ color: colors.red }}>[superseded]</span></div>
                  <div>v2: "Use Zustand over Redux" <span style={{ color: colors.green }}>[current]</span></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
