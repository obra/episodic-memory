import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { IntroScene } from "./scenes/IntroScene";
import { ProblemScene } from "./scenes/ProblemScene";
import { ExtractScene } from "./scenes/ExtractScene";
import { ConsolidateScene } from "./scenes/ConsolidateScene";
import { ScopeScene } from "./scenes/ScopeScene";
import { SearchScene } from "./scenes/SearchScene";
import { OutroScene } from "./scenes/OutroScene";
import { colors } from "./styles";

// 7 scenes, 6 transitions (12f each = 72f overlap)
// Scene durations: 150+150+210+210+150+150+120 = 1140
// Effective: 1140 - 72 = 1068 frames = ~35.6 seconds @ 30fps

const T = 12;

export const FactConsolidation = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <TransitionSeries>
        {/* 1. Intro (5s) */}
        <TransitionSeries.Sequence durationInFrames={150}>
          <IntroScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: T })}
        />

        {/* 2. Problem (5s) */}
        <TransitionSeries.Sequence durationInFrames={150}>
          <ProblemScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: T })}
        />

        {/* 3. Extract (7s) */}
        <TransitionSeries.Sequence durationInFrames={210}>
          <ExtractScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: T })}
        />

        {/* 4. Consolidate (7s) */}
        <TransitionSeries.Sequence durationInFrames={210}>
          <ConsolidateScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={linearTiming({ durationInFrames: T })}
        />

        {/* 5. Scope (5s) */}
        <TransitionSeries.Sequence durationInFrames={150}>
          <ScopeScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: T })}
        />

        {/* 6. Search (5s) */}
        <TransitionSeries.Sequence durationInFrames={150}>
          <SearchScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: T })}
        />

        {/* 7. Outro (4s) */}
        <TransitionSeries.Sequence durationInFrames={120}>
          <OutroScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
