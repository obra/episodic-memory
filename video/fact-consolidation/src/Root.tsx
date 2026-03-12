import { Composition } from "remotion";
import { FactConsolidation } from "./FactConsolidation";

export const RemotionRoot = () => {
  return (
    <Composition
      id="FactConsolidation"
      component={FactConsolidation}
      durationInFrames={1068}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
