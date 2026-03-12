import { CSSProperties } from "react";

export const colors = {
  bg: "#0d1117",
  surface: "#161b22",
  surface2: "#21262d",
  border: "#30363d",
  text: "#e6edf3",
  textMuted: "#8b949e",
  accent: "#58a6ff",
  green: "#3fb950",
  purple: "#d2a8ff",
  orange: "#f0883e",
  red: "#f85149",
  yellow: "#d29922",
};

export const fullScreen: CSSProperties = {
  width: "100%",
  height: "100%",
  position: "absolute",
  top: 0,
  left: 0,
};

export const centered: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "column",
};

export const monoFont = "'SF Mono', 'Menlo', 'Courier New', monospace";
export const sansFont =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
