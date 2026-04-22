import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { MainComposition, CompositionProps } from './Composition';
import { MotionGraphicComposition, MotionGraphicCompositionProps } from './MotionGraphicComposition';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MainVideo"
        component={MainComposition as any}
        fps={30}
        width={720}
        height={1280} // 9:16 aspect ratio for shorts
        calculateMetadata={({ props }) => {
          return {
            durationInFrames: (props as any).durationInFrames || 300,
          };
        }}
        defaultProps={{
          imageUrls: [],
          avatarClipData: [],
          audioUrl: '',
          musicUrl: '',
          captionData: {
            segments: [],
          },
          durationInFrames: 300,
          captionStyle: 'bold-pop',
          language: 'en-IN',
        } as CompositionProps}
      />
      <Composition
        id="MotionGraphic"
        component={MotionGraphicComposition as any}
        fps={30}
        width={1920}
        height={1080}
        calculateMetadata={({ props }) => {
          const p = props as unknown as MotionGraphicCompositionProps;
          return {
            durationInFrames: p.durationInFrames || 900,
            width: p.width || 1920,
            height: p.height || 1080,
          };
        }}
        defaultProps={{
          scenes: [],
          theme: { palette: 'midnight', font: 'Inter', animationStyle: 'smooth' },
          durationInFrames: 900,
          fps: 30,
          width: 1920,
          height: 1080,
          musicUrl: '',
          audioUrl: '',
          audioDuration: 0,
          voiceoverEnabled: false,
        } as MotionGraphicCompositionProps}
      />
    </>
  );
};

registerRoot(RemotionRoot);

