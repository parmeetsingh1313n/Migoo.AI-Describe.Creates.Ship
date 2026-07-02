import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadNotoHindi } from '@remotion/google-fonts/NotoSansDevanagari';
import { loadFont as loadOrbitron } from '@remotion/google-fonts/Orbitron';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadPoppins } from '@remotion/google-fonts/Poppins';
import { loadFont as loadSpaceMono } from '@remotion/google-fonts/SpaceMono';
import React, { useMemo, useState, useCallback } from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  Video,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { captionStyles } from '../lib/caption-styles';

// Preload fonts
loadFont('normal', { weights: ['900'] });
loadInter('normal', { weights: ['800'] });
loadSpaceMono('normal', { weights: ['700'] });
loadOrbitron('normal', { weights: ['700'] });
loadPoppins('normal', { weights: ['800'] });
loadPlayfair('normal', { weights: ['700'] });
loadNotoHindi('normal', { weights: ['700'] });

export interface CaptionSegment {
  text: string;
  start: number; // in seconds
  end: number;   // in seconds
}

export interface AvatarClipProps {
  videoUrl: string;
  audioUrl: string;
  durationSec: number;
  videoDurationSec?: number; // actual duration of the avatar video file
}

export interface CompositionProps {
  imageUrls: string[];
  sceneVideoUrls?: string[];
  sceneVideoDurations?: number[];
  introClip?: AvatarClipProps;
  outroClip?: AvatarClipProps;
  audioUrl: string;
  audioDuration?: number;
  musicUrl?: string;
  captionData: {
    segments: CaptionSegment[];
  };
  captionStyle?: string;
  language?: string;
  durationInFrames: number;
}

const SAFETY_MARGIN_SEC = 0.5;

// ─── SafeImg wrapper: catches image load errors gracefully ───────────────────
// Instead of letting Remotion's cancelRender fire on 403/network errors,
// we catch the error and show a black frame as fallback.
const SafeImg: React.FC<React.ComponentProps<typeof Img>> = (props) => {
  const [hasError, setHasError] = useState(false);
  const handleError = useCallback(() => {
    console.warn(`⚠️ SafeImg: Failed to load image: ${props.src?.toString().substring(0, 80)}...`);
    setHasError(true);
  }, [props.src]);

  if (hasError) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#1a1a2e' }}>
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        }} />
      </AbsoluteFill>
    );
  }

  return <Img {...props} onError={handleError} />;
};

// ─── SafeVideo wrapper: catches video load errors gracefully ──────────────────
// Used ONLY for AvatarClipScene — avatar videos need HTML5 real-time playback.
// Scene videos use SafeOffthreadVideo (Rust/FFmpeg frame extraction) instead.
const SafeVideo: React.FC<React.ComponentProps<typeof Video>> = (props) => {
  const [hasError, setHasError] = useState(false);
  const handleError = useCallback((err: Error) => {
    console.warn(
      `⚠️ SafeVideo: Error loading video: ${props.src?.toString().substring(0, 80)}... — ${err.message}`
    );
    setHasError(true);
  }, [props.src]);

  if (hasError || !props.src) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#1a1a2e' }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background:
              'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          }}
        />
      </AbsoluteFill>
    );
  }

  return <Video {...props} onError={handleError} />;
};

// ─── SafeOffthreadVideo: Rust/FFmpeg-based decoder for scene videos ───────────
// OffthreadVideo uses Remotion's native frame extractor instead of the browser's
// HTML5 video decoder. This ELIMINATES the delayRender() timeout that occurs
// when Chromium can't decode a video file during CLI rendering.
// It supports playbackRate, muted, style — but NOT pauseWhenBuffering/crossOrigin.
const SafeOffthreadVideo: React.FC<React.ComponentProps<typeof OffthreadVideo>> = (props) => {
  const [hasError, setHasError] = useState(false);
  const handleError = useCallback((err: Error) => {
    console.warn(
      `⚠️ SafeOffthreadVideo: Error loading video: ${props.src?.toString().substring(0, 80)}... — ${err.message}`
    );
    setHasError(true);
  }, [props.src]);

  if (hasError || !props.src) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#1a1a2e' }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            background:
              'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          }}
        />
      </AbsoluteFill>
    );
  }

  return <OffthreadVideo {...props} onError={handleError} />;
};

// ─── Crossfade overlay: fades in then out to create a smooth bridge ───────────
const CrossfadeBridge: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const half = durationInFrames / 2;
  // First half: fade TO black, second half: fade FROM black
  const opacity = frame < half
    ? interpolate(frame, [0, half], [0, 1], { extrapolateRight: 'clamp' })
    : interpolate(frame, [half, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: 'black',
        opacity,
        zIndex: 20,
      }}
    />
  );
};

// ─── HeyGen Avatar clip scene (video muted, custom TTS audio plays) ────────────
// The TTS audio is already time-stretched (via FFmpeg atempo) to match the avatar
// video's duration, so the video plays ONCE at natural speed — no looping needed.
// Previously a <Loop> was used here, but even tiny mismatches between
// sourceDurationFrames and the actual video caused visible jitter/stutter at the
// loop boundary.  Without Loop the last frame simply freezes (invisible) or the
// Sequence boundary trims cleanly.
const AvatarClipScene: React.FC<{
  videoUrl: string;
  audioUrl: string;
  durationInFrames: number;
  videoDurationSec?: number; // actual length of the avatar video file
}> = ({ videoUrl, audioUrl, durationInFrames, videoDurationSec }) => {
  const resolvedVideoUrl = useMemo(() => resolveLocalUrl(videoUrl) || "", [videoUrl]);
  const resolvedAudioUrl = useMemo(() => resolveLocalUrl(audioUrl) || "", [audioUrl]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* Play avatar video once at natural speed — no Loop, no playbackRate stretch */}
      <SafeVideo
        src={resolvedVideoUrl}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        muted
        crossOrigin="anonymous"
        playbackRate={1}
        pauseWhenBuffering
      />
      {/* Sarvam-generated English voice audio */}
      {resolvedAudioUrl && <Audio src={resolvedAudioUrl} crossOrigin="anonymous" />}
    </AbsoluteFill>
  );
};

// ─── AI-generated image scene with ken-burns animation ───────────────────────
const VideoScene: React.FC<{
  imageUrl: string;
  duration: number;
  index: number;
}> = ({ imageUrl, duration, index }) => {
  const frame = useCurrentFrame();
  const animationType = index % 3;
  let animationStyle: React.CSSProperties = {};

  if (animationType === 0) {
    const scale = interpolate(frame, [0, duration], [1, 1.1], { extrapolateRight: 'clamp' });
    animationStyle = { transform: `scale(${scale})` };
  } else if (animationType === 1) {
    const translateY = interpolate(frame, [0, duration], [0, -30], { extrapolateRight: 'clamp' });
    animationStyle = { transform: `translateY(${translateY}px) scale(1.05)` };
  } else {
    const translateY = interpolate(frame, [0, duration], [-30, 0], { extrapolateRight: 'clamp' });
    animationStyle = { transform: `translateY(${translateY}px) scale(1.05)` };
  }

  return (
    <AbsoluteFill>
      <SafeImg
        src={imageUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          ...animationStyle,
        }}
        crossOrigin="anonymous"
      />
    </AbsoluteFill>
  );
};

const VideoClipScene: React.FC<{
  videoUrl: string;
  imageUrl?: string;
  duration: number; // in frames (target sequence duration)
  sourceDuration?: number; // in seconds (actual AI video duration, e.g. 5 or 10 for Kling)
}> = ({ videoUrl, imageUrl, duration, sourceDuration }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();

  const resolvedVideoUrl = useMemo(() => resolveLocalUrl(videoUrl) || "", [videoUrl]);
  const resolvedImageUrl = useMemo(() => resolveLocalUrl(imageUrl) || "", [imageUrl]);

  // Actual length of the video file in seconds (default to 5s if undefined)
  const actualLength = sourceDuration && sourceDuration > 0 ? sourceDuration : 5;
  // Subtract a safe margin to avoid seeking past the file end
  const safeLength = Math.max(0.5, actualLength - SAFETY_MARGIN_SEC);

  const targetDurationSec = duration / fps;

  // WAN videos are FFmpeg-stretched to exact duration before Appwrite upload.
  // Always play at 1.0x — the stored file duration matches the scene duration.
  // If there is a tiny gap, the fallback image below fills it.
  const pbRate = 1.0;

  // Frames the video covers at natural speed
  const videoPlayFrames = Math.floor(safeLength * fps);

  if (resolvedVideoUrl && frame < videoPlayFrames) {
    return (
      <AbsoluteFill style={{ backgroundColor: 'black' }}>
        <SafeOffthreadVideo
          src={resolvedVideoUrl}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          muted
          playbackRate={pbRate}
        />
      </AbsoluteFill>
    );
  }

  // Video exhausted or no URL — fall back to static image with ken-burns
  return (
    <AbsoluteFill>
      {resolvedImageUrl ? (
        <SafeImg
          src={resolvedImageUrl}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          crossOrigin="anonymous"
        />
      ) : (
        <div style={{ width: '100%', height: '100%', backgroundColor: 'black' }} />
      )}
    </AbsoluteFill>
  );
};

// ─── Slideshow scene: cycles N images across the scene duration ───────────────
const SlideshowScene: React.FC<{
  urls: string[];
  duration: number; // total frames for this scene
}> = ({ urls, duration }) => {
  const frame = useCurrentFrame();
  const perSlide = Math.floor(duration / urls.length);
  const FADE_FRAMES = 8; // cross-fade duration

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {urls.map((url, idx) => {
        const start = idx * perSlide;
        const end   = start + perSlide;
        if (frame < start - FADE_FRAMES || frame >= end + FADE_FRAMES) return null;

        const opacity = interpolate(
          frame,
          [start - FADE_FRAMES, start, end - FADE_FRAMES, end],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
        const resolvedUrl = resolveLocalUrl(url) || '';
        return (
          <AbsoluteFill key={idx} style={{ opacity }}>
            <SafeImg
              src={resolvedUrl}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              crossOrigin="anonymous"
            />
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};

const SplitScreenScene: React.FC<{
  urls: [string, string];
  duration: number;
  sourceDuration?: number;
  fallbackImageUrl?: string;
}> = ({ urls, duration, sourceDuration, fallbackImageUrl }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const targetDurationSec = duration / fps;

  const actualLength = sourceDuration && sourceDuration > 0 ? sourceDuration : 5;
  const safeLength = Math.max(0.5, actualLength - 0.4);

  // WAN videos are FFmpeg-stretched to exact duration before Appwrite upload.
  // Always play at 1.0x — the stored file duration matches the scene duration.
  const pbRate = 1.0;

  const videoPlayFrames = Math.floor(safeLength * fps);

  const topUrl    = useMemo(() => resolveLocalUrl(urls[0]) || '', [urls]);
  const bottomUrl = useMemo(() => resolveLocalUrl(urls[1]) || '', [urls]);
  const resolvedImageUrl = useMemo(() => resolveLocalUrl(fallbackImageUrl) || '', [fallbackImageUrl]);

  if (topUrl && bottomUrl && frame < videoPlayFrames) {
    return (
      <AbsoluteFill style={{ backgroundColor: 'black', flexDirection: 'column' }}>
        {/* Top half */}
        <div style={{ flex: 1, overflow: 'hidden', borderBottom: '3px solid rgba(139,92,246,0.6)' }}>
          <SafeOffthreadVideo
            src={topUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            muted
            playbackRate={pbRate}
          />
        </div>
        {/* Bottom half */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <SafeOffthreadVideo
            src={bottomUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            muted
            playbackRate={pbRate}
          />
        </div>
      </AbsoluteFill>
    );
  }

  // Video exhausted or no URLs — fallback
  return (
    <AbsoluteFill>
      {resolvedImageUrl ? (
        <SafeImg
          src={resolvedImageUrl}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          crossOrigin="anonymous"
        />
      ) : (
        <div style={{ width: '100%', height: '100%', backgroundColor: 'black' }} />
      )}
    </AbsoluteFill>
  );
};

// ─── Composite scene: mixed user assets (images + videos + splits) in order ──
// Distributes the scene's total frame duration across all assets proportionally.
// Videos are stretched via playbackRate. Images get fair share with ken-burns.
// NEVER modifies the user's assets — only arranges and times them.

interface CompositeAssetEntry {
  kind: 'image' | 'video' | 'split';
  url?: string;
  urls?: [string, string];
  durationSec?: number;
  durationsSec?: number[]; // per-URL durations for split assets
  isImgToVideo?: boolean;
}

const CompositeScene: React.FC<{
  assets: CompositeAssetEntry[];
  duration: number; // total frames for this scene
  fallbackImageUrl?: string;
}> = ({ assets, duration, fallbackImageUrl }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const totalSec = duration / fps;
  const CROSSFADE_FRAMES = 6;

  // ── Time allocation strategy ─────────────────────────────────────────────
  // 1. Videos get time proportional to their actual duration
  // 2. Images get at least 3s each
  // 3. If total exceeds scene duration → compress proportionally
  // 4. If total is less → stretch videos proportionally to fill
  const allocations = useMemo(() => {
    const MIN_IMAGE_SEC = 3;

    // Count totals
    const imageCount = assets.filter(a => a.kind === 'image').length;
    const videoAssets = assets.filter(a => a.kind === 'video' || a.kind === 'split');
    const totalVideoSec = videoAssets.reduce((sum, a) => sum + (a.durationSec || 5), 0);
    const totalImageSec = imageCount * MIN_IMAGE_SEC;
    const rawTotal = totalVideoSec + totalImageSec;

    // Calculate per-asset frame allocations
    const allocs: number[] = [];

    if (rawTotal <= 0) {
      // Edge case: all empty → equal split
      const each = Math.floor(duration / assets.length);
      return assets.map(() => each);
    }

    if (rawTotal <= totalSec) {
      // We have room to spare → stretch videos to fill
      const extraSec = totalSec - totalImageSec;
      const videoScale = totalVideoSec > 0 ? extraSec / totalVideoSec : 1;

      for (const asset of assets) {
        if (asset.kind === 'image') {
          allocs.push(Math.round(MIN_IMAGE_SEC * fps));
        } else {
          const vidSec = (asset.durationSec || 5) * videoScale;
          allocs.push(Math.round(vidSec * fps));
        }
      }
    } else {
      // Total exceeds scene → compress proportionally
      const scale = totalSec / rawTotal;
      for (const asset of assets) {
        if (asset.kind === 'image') {
          allocs.push(Math.max(Math.round(MIN_IMAGE_SEC * scale * fps), Math.round(fps))); // min 1s
        } else {
          allocs.push(Math.round((asset.durationSec || 5) * scale * fps));
        }
      }
    }

    // Adjust rounding to exactly match total duration
    const allocTotal = allocs.reduce((a, b) => a + b, 0);
    const diff = duration - allocTotal;
    if (diff !== 0 && allocs.length > 0) {
      // Add/subtract the difference to the largest video allocation
      let largestIdx = 0;
      for (let j = 1; j < allocs.length; j++) {
        if (allocs[j] > allocs[largestIdx]) largestIdx = j;
      }
      allocs[largestIdx] += diff;
    }

    return allocs;
  }, [assets, duration, fps, totalSec]);

  // ── Compute cumulative start frames ──────────────────────────────────────
  const startFrames = useMemo(() => {
    const starts: number[] = [0];
    for (let k = 0; k < allocations.length - 1; k++) {
      starts.push(starts[k] + allocations[k]);
    }
    return starts;
  }, [allocations]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {assets.map((asset, idx) => {
        const assetStart = startFrames[idx];
        const assetDuration = allocations[idx];
        if (assetDuration <= 0) return null;

        // Only render assets that are in view (± crossfade)
        if (frame < assetStart - CROSSFADE_FRAMES || frame >= assetStart + assetDuration + CROSSFADE_FRAMES) {
          return null;
        }

        // Crossfade opacity
        const opacity = interpolate(
          frame,
          [
            assetStart - CROSSFADE_FRAMES,
            assetStart,
            assetStart + assetDuration - CROSSFADE_FRAMES,
            assetStart + assetDuration,
          ],
          [0, 1, 1, idx === assets.length - 1 ? 1 : 0], // last asset stays visible
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );

        const localFrame = frame - assetStart;

        return (
          <AbsoluteFill key={idx} style={{ opacity }}>
            {asset.kind === 'image' && asset.url && (
              <CompositeImageSub
                url={asset.url}
                duration={assetDuration}
                localFrame={localFrame}
                index={idx}
              />
            )}
            {asset.kind === 'video' && asset.url && (
              <CompositeVideoSub
                url={asset.url}
                imageUrl={fallbackImageUrl}
                duration={assetDuration}
                sourceDuration={asset.durationSec}
              />
            )}
            {asset.kind === 'split' && asset.urls && (
              <CompositeSplitSub
                urls={asset.urls}
                duration={assetDuration}
                sourceDuration={asset.durationSec || (asset.durationsSec ? Math.min(...asset.durationsSec.filter(Boolean)) : undefined)}
              />
            )}
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};

// ── Sub-components for CompositeScene ─────────────────────────────────────────

const CompositeImageSub: React.FC<{
  url: string;
  duration: number;
  localFrame: number;
  index: number;
}> = ({ url, duration, localFrame, index }) => {
  const resolvedUrl = useMemo(() => resolveLocalUrl(url) || '', [url]);
  const animationType = index % 3;

  let animationStyle: React.CSSProperties = {};
  const safeFrame = Math.max(0, localFrame);

  if (animationType === 0) {
    const scale = interpolate(safeFrame, [0, duration], [1, 1.12], { extrapolateRight: 'clamp' });
    animationStyle = { transform: `scale(${scale})` };
  } else if (animationType === 1) {
    const translateY = interpolate(safeFrame, [0, duration], [0, -25], { extrapolateRight: 'clamp' });
    animationStyle = { transform: `translateY(${translateY}px) scale(1.06)` };
  } else {
    const translateY = interpolate(safeFrame, [0, duration], [-25, 0], { extrapolateRight: 'clamp' });
    animationStyle = { transform: `translateY(${translateY}px) scale(1.06)` };
  }

  return (
    <AbsoluteFill>
      <SafeImg
        src={resolvedUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          ...animationStyle,
        }}
        crossOrigin="anonymous"
      />
    </AbsoluteFill>
  );
};

const CompositeVideoSub: React.FC<{
  url: string;
  imageUrl?: string;
  duration: number; // frames
  sourceDuration?: number; // seconds
}> = ({ url, imageUrl, duration, sourceDuration }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const resolvedUrl = useMemo(() => resolveLocalUrl(url) || '', [url]);
  const resolvedImageUrl = useMemo(() => resolveLocalUrl(imageUrl) || '', [imageUrl]);
  const targetSec = duration / fps;

  const actual = sourceDuration && sourceDuration > 0 ? sourceDuration : 5;
  const safeActual = Math.max(0.5, actual - SAFETY_MARGIN_SEC);

  // Safe stretch: slow-down only — never speed up past 1.0x.
  const pbRate = useMemo(() => {
    if (targetSec > safeActual) {
      return Math.max(0.0625, safeActual / targetSec);
    }
    return 1.0;
  }, [safeActual, targetSec]);

  const videoPlayFrames = Math.floor((safeActual * fps) / pbRate);

  if (resolvedUrl && frame < videoPlayFrames) {
    return (
      <AbsoluteFill style={{ backgroundColor: 'black' }}>
        <SafeOffthreadVideo
          src={resolvedUrl}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          muted
          playbackRate={pbRate}
        />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill>
      {resolvedImageUrl ? (
        <SafeImg
          src={resolvedImageUrl}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          crossOrigin="anonymous"
        />
      ) : (
        <div style={{ width: '100%', height: '100%', backgroundColor: 'black' }} />
      )}
    </AbsoluteFill>
  );
};

const CompositeSplitSub: React.FC<{
  urls: [string, string];
  duration: number;
  sourceDuration?: number;
}> = ({ urls, duration, sourceDuration }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const targetSec = duration / fps;
  const safeSrcDur = Math.max(0.5, (sourceDuration || 5) - SAFETY_MARGIN_SEC);
  const pbRate = targetSec > safeSrcDur
    ? Math.max(0.0625, safeSrcDur / targetSec)
    : 1.0;
  const videoPlayFrames = Math.floor((safeSrcDur * fps) / pbRate);

  const topUrl = useMemo(() => resolveLocalUrl(urls[0]) || '', [urls]);
  const bottomUrl = useMemo(() => resolveLocalUrl(urls[1]) || '', [urls]);

  if (frame < videoPlayFrames) {
    return (
      <AbsoluteFill style={{ backgroundColor: 'black', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'hidden', borderBottom: '3px solid rgba(139,92,246,0.6)' }}>
          <SafeOffthreadVideo
            src={topUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            muted
            playbackRate={pbRate}
          />
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <SafeOffthreadVideo
            src={bottomUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            muted
            playbackRate={pbRate}
          />
        </div>
      </AbsoluteFill>
    );
  }

  return <div style={{ width: '100%', height: '100%', backgroundColor: 'black' }} />;
};


// ─── Captions component (only shown during content scenes) ────────────────────
const Captions: React.FC<{
  segments: CaptionSegment[];
  styleId?: string;
  language?: string;
}> = ({ segments, styleId = 'hormozi', language = 'en-IN' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Sequence resets frame to 0 at contentStart. Audio also starts at contentStart with no delay.
  // SYNC_OFFSET: 0 = captions appear exactly when the word is spoken (Whisper timestamps).
  // Set negative to delay captions, positive to show them slightly early.
  const SYNC_OFFSET = -0.5;
  const rawTime = (frame / fps) + SYNC_OFFSET;

  const style = useMemo(() =>
    captionStyles.find(s => s.id === styleId) || captionStyles[0],
    [styleId]
  );

  const activeSegment = segments.find(
    (s) => rawTime >= s.start && rawTime <= s.end
  );

  if (!activeSegment || rawTime < 0) return null;

  // Calculate progress within the active segment
  const totalDuration = activeSegment.end - activeSegment.start;
  const rawProgress = totalDuration > 0 
    ? Math.max(0, Math.min(1, (rawTime - activeSegment.start) / totalDuration))
    : 0;

  // Apply a gentle ease-out/decelerating curve so the captions feel slightly slower/more relaxed,
  // matching natural human speaking cadence which naturally slows down towards the end of a segment.
  const adjustedProgress = Math.pow(rawProgress, 1.15); // Gently dampens and slows down highlights

  // The effective currentTime to use for all calculations inside this segment:
  const currentTime = activeSegment.start + adjustedProgress * totalDuration;

  // ── Base style applied to the caption container ─────────────────────────
  const baseStyle: React.CSSProperties = {
    fontFamily: language === 'hi-IN' ? "'Noto Sans Devanagari', sans-serif" : style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    color: style.color,
    padding: style.padding,
    borderRadius: style.borderRadius,
    textTransform: style.textTransform as any,
    textAlign: 'center' as const,
    lineHeight: 1.3,
    letterSpacing: (style as any).letterSpacing || undefined,
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
    gap: '6px',
  };

  if (style.backgroundColor !== 'transparent') baseStyle.backgroundColor = style.backgroundColor;
  if (style.textShadow !== 'none') baseStyle.textShadow = style.textShadow;
  if (style.textStroke !== 'none') (baseStyle as any).WebkitTextStroke = style.textStroke;

  // ── Word-level animation helpers ────────────────────────────────────────
  const words = activeSegment.text.split(' ');
  const timePerWord = totalDuration / words.length;
  const activeWordIndex = Math.floor((currentTime - activeSegment.start) / timePerWord);

  // ── Segment-level animations (applied to entire container) ──────────────
  let containerAnimation: React.CSSProperties = {};

  if (style.animation === 'pop') {
    const springValue = interpolate(currentTime - activeSegment.start, [0, 0.1, 0.2], [0.8, 1.1, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    containerAnimation.transform = `scale(${springValue})`;
  } else if (style.animation === 'glow') {
    const glow = interpolate(Math.sin(frame / 5), [-1, 1], [0.8, 1.2], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    containerAnimation.opacity = glow;
  } else if (style.animation === 'bounce') {
    const bounceVal = interpolate(currentTime - activeSegment.start, [0, 0.15, 0.3], [50, -10, 0], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    containerAnimation.transform = `translateY(${bounceVal}px)`;
  } else if (style.animation === 'fade') {
    const opacity = interpolate(currentTime - activeSegment.start, [0, 0.3], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    containerAnimation.opacity = opacity;
  }

  // ── Render text based on animation type ─────────────────────────────────
  const renderText = () => {
    // ── WORD-POP (Hormozi / MrBeast / Gradient): each word shown, active word
    //    scales up and changes to highlightColor with optional extra styles ──
    if (style.animation === 'word-pop') {
      const isUpper = style.textTransform === 'uppercase';
      return words.map((word, i) => {
        const isCurrent = i === activeWordIndex;
        const scale = isCurrent
          ? interpolate(
              (currentTime - activeSegment.start) - i * timePerWord,
              [0, 0.08, 0.16],
              [0.85, 1.22, 1.0],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
            )
          : 1;
        const wordColor = isCurrent ? style.highlightColor : style.color;
        const activeExtra = isCurrent && (style as any).activeWordStyle ? (style as any).activeWordStyle : {};
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              color: wordColor,
              transform: `scale(${scale})`,
              transition: 'color 0.08s ease',
              ...activeExtra,
            }}
          >
            {isUpper ? word.toUpperCase() : word}
          </span>
        );
      });
    }

    // ── KARAOKE: word-by-word highlight with optional activeWordStyle ────────
    if (style.animation === 'karaoke') {
      const isUpper = style.textTransform === 'uppercase';
      return words.map((word, i) => {
        const isActive = i <= activeWordIndex;
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              color: isActive ? style.highlightColor : style.color,
              transition: 'color 0.1s ease',
              ...(isActive && (style as any).activeWordStyle ? (style as any).activeWordStyle : {}),
            }}
          >
            {isUpper ? word.toUpperCase() : word}
          </span>
        );
      });
    }

    // ── WORD-BOX: active word gets a background box highlight ────────────────
    if (style.animation === 'word-box') {
      const isUpper = style.textTransform === 'uppercase';
      return words.map((word, i) => {
        const isActive = i <= activeWordIndex;
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              transition: 'background-color 0.1s ease',
              ...(isActive && (style as any).activeWordStyle ? (style as any).activeWordStyle : {}),
            }}
          >
            {isUpper ? word.toUpperCase() : word}
          </span>
        );
      });
    }

    // ── WORD-BOUNCE: active word bounces upward ─────────────────────────────
    if (style.animation === 'word-bounce') {
      const isUpper = style.textTransform === 'uppercase';
      return words.map((word, i) => {
        const isActive = i <= activeWordIndex;
        const isCurrent = i === activeWordIndex;
        const yOffset = isCurrent
          ? interpolate(
              (currentTime - activeSegment.start) - i * timePerWord,
              [0, 0.08, 0.18, 0.28],
              [12, -8, 2, 0],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
            )
          : 0;
        const scale = isCurrent ? 1.15 : 1;
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              color: isActive ? style.highlightColor : style.color,
              transform: `translateY(${yOffset}px) scale(${scale})`,
              transition: 'color 0.08s ease',
            }}
          >
            {isUpper ? word.toUpperCase() : word}
          </span>
        );
      });
    }

    // ── TYPEWRITER: character-by-character ───────────────────────────────────
    if (style.animation === 'typewriter') {
      const chars = activeSegment.text.length;
      const charIndex = Math.floor(interpolate(
        currentTime - activeSegment.start,
        [0, totalDuration * 0.8],
        [0, chars],
        { extrapolateRight: 'clamp' }
      ));
      return <span>{activeSegment.text.slice(0, charIndex)}</span>;
    }

    // ── SINGLE-WORD (MrBeast): only the current spoken word is shown ─────────
    // Each word pops in from scale 0 with a spring, holds, then is replaced.
    if (style.animation === 'single-word') {
      const currentWord = words[Math.min(activeWordIndex, words.length - 1)];
      if (!currentWord) return null;
      const wordStart = activeSegment.start + activeWordIndex * timePerWord;
      const elapsed = Math.max(0, currentTime - wordStart);
      // Spring pop: 0 → overshoot → settle
      const scale = interpolate(
        elapsed,
        [0, 0.06, 0.12, 0.2],
        [0.5, 1.18, 0.95, 1.0],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
      );
      const displayWord = style.textTransform === 'uppercase'
        ? currentWord.toUpperCase()
        : currentWord;
      return (
        <span
          key={activeWordIndex}
          style={{
            display: 'inline-block',
            transform: `scale(${scale})`,
          }}
        >
          {displayWord}
        </span>
      );
    }

    // ── Default: plain text (pop / bounce / fade / glow handled at container) ─
    return <span>{activeSegment.text}</span>;
  };

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '15%', paddingLeft: '40px', paddingRight: '40px', zIndex: 10 }}>
      <div style={{ ...baseStyle, ...containerAnimation }}>
        {renderText()}
      </div>
    </AbsoluteFill>
  );
};

export function resolveLocalUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let cleanUrl = url;

  // ── CRITICAL FIX (Windows / non-C: drive) ────────────────────────────────
  // Remotion's staticFile() on Windows generates file:///A:/React%20Projects/...
  // URLs. The compositor (Rust) ONLY accepts http:// or https:// and rejects
  // file:// with "Can only download URLs starting with http:// or https://".
  // The Audio component in Puppeteer also fails with ERR_UNKNOWN_URL_SCHEME.
  //
  // Localhost URLs from a different port (e.g. DB stored http://localhost:3000/...
  // but server now runs on 3001) must have their origin updated to the active
  // window origin so requests always hit the correct live server.
  // ─────────────────────────────────────────────────────────────────────────

  // For localhost/127.0.0.1 URLs, strip the double /public/tmp/ prefix that
  // can appear in legacy DB entries, then update to the active window origin.
  if (cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1')) {
    // Strip stale /public/tmp/ and /public/avatars/ double-prefix
    cleanUrl = cleanUrl.replace(/\/public\/tmp\//g, '/tmp/');
    cleanUrl = cleanUrl.replace(/\/public\/avatars\//g, '/avatars/');
    // IMPORTANT: Do NOT rewrite URLs that are already on port 3000.
    // Port 3000 is the Next.js dev server which always serves public/ and always
    // has the dynamically downloaded scene assets (music, voiceover, images, videos).
    // Rewriting :3000 → :3001 (Remotion's webpack server) causes 404 because
    // Remotion's temp bundle dir never contains copies of these dynamic files.
    const isNextJsAsset = cleanUrl.includes(':3000/');
    if (!isNextJsAsset && typeof window !== 'undefined' && window.location) {
      cleanUrl = cleanUrl.replace(/^https?:\/\/[^\/]+/, window.location.origin);
    }
    return cleanUrl;
  }

  if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
    return cleanUrl;
  }

  if (cleanUrl.startsWith('file:///')) return cleanUrl;

  // Absolute Windows paths (A:/path/to/image.jpg)
  if (cleanUrl.match(/^[a-zA-Z]:\//)) {
    return cleanUrl;
  }

  // Unix absolute paths not under /public/ or /tmp/ — return as-is
  if (cleanUrl.startsWith('/') && !cleanUrl.startsWith('/public/') && !cleanUrl.startsWith('/tmp/')) {
      return cleanUrl;
  }

  // Strip /public/ prefix from legacy relative paths before passing to staticFile()
  // (staticFile() re-adds the correct prefix for Remotion's webpack server)
  while (cleanUrl.startsWith('/public/') || cleanUrl.startsWith('public/')) {
    cleanUrl = cleanUrl.replace(/^\/?public\//, '');
  }

  // Avatar static files → staticFile() (these stay in the bundle)
  if (cleanUrl.includes('avatars/avatar')) {
    const match = cleanUrl.match(/avatars\/avatar[0-9]+-(intro|outro)\.(mp4|webm)/);
    if (match) return staticFile(match[0]);
  }

  // All relative paths (including /tmp/) → staticFile()
  // Remotion's webpack server in Next.js projects serves the public dir WITH
  // the /public/ prefix, so staticFile() is required to generate the correct URL.
  const finalUrl = cleanUrl.startsWith('/') ? cleanUrl.substring(1) : cleanUrl;
  return staticFile(finalUrl);
}

// ─── Main Composition ─────────────────────────────────────────────────────────
export const MainComposition: React.FC<CompositionProps> = ({
  imageUrls,
  sceneVideoUrls,
  sceneVideoDurations,
  introClip,
  outroClip,
  audioUrl,
  audioDuration,
  musicUrl,
  captionData,
  captionStyle,
  language,
}) => {
  const { durationInFrames, fps } = useVideoConfig();

  // ── Timeline math ─────────────────────────────────────────────────────────
  const BRIDGE_FRAMES = 30; // 1.0s crossfade at intro/outro transitions (smoother)
  const CAPTION_DELAY_FRAMES = 0; // Removed delay as requested

  const introFrames = introClip ? Math.round(introClip.durationSec * fps) : 0;
  const outroFrames = outroClip ? Math.round(outroClip.durationSec * fps) : 0;
  const contentFrames = durationInFrames - introFrames - outroFrames;
  const sceneDuration = Math.floor(contentFrames / Math.max(imageUrls?.length || 1, 1));

  // Content starts after intro
  const contentStart = introFrames;
  // Outro starts after content
  const outroStart = contentStart + contentFrames;

  const resolvedMusicUrl = useMemo(() => resolveLocalUrl(musicUrl), [musicUrl]);
  const resolvedAudioUrl = useMemo(() => resolveLocalUrl(audioUrl), [audioUrl]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* ── Background Music: runs throughout entire video ── */}
      {resolvedMusicUrl && <Audio src={resolvedMusicUrl} volume={0.12} loop crossOrigin="anonymous" />}

      {/* ══════════════════════════════════════════════════
          INTRO SECTION — HeyGen avatar clip (English)
      ══════════════════════════════════════════════════ */}
      {introClip && (
        <Sequence from={0} durationInFrames={introFrames}>
          <AvatarClipScene videoUrl={introClip.videoUrl} audioUrl={introClip.audioUrl} durationInFrames={introFrames} videoDurationSec={introClip.videoDurationSec} />
        </Sequence>
      )}

      {/* Crossfade bridge: Intro → Content */}
      {introClip && (
        <Sequence from={introFrames - BRIDGE_FRAMES} durationInFrames={BRIDGE_FRAMES * 2}>
          <CrossfadeBridge durationInFrames={BRIDGE_FRAMES * 2} />
        </Sequence>
      )}

      {/* ══════════════════════════════════════════════════
          CONTENT SECTION — 6 AI-image scenes (selected language narration)
      ══════════════════════════════════════════════════ */}

      {/* Main narration audio: starts at contentStart, plays for audioDuration */}
      {resolvedAudioUrl && (
        <Sequence from={contentStart} durationInFrames={contentFrames}>
          <Audio src={resolvedAudioUrl} crossOrigin="anonymous" />
        </Sequence>
      )}

      {/* AI scene clips: use video if available, fallback to static image */}
      {imageUrls?.map((url, i) => {
        const sceneVideoUrl    = sceneVideoUrls?.[i];
        const sourceDurationSec = sceneVideoDurations?.[i];

        // ── Parse JSON payloads (composite / split-screen / slideshow) ────────
        let compositePayload: { type: 'composite'; assets: CompositeAssetEntry[] } | null = null;
        let splitPayload: { type: 'split'; urls: [string, string] } | null = null;
        let slideshowPayload: { type: 'slideshow'; urls: string[] } | null = null;

        // Check sceneVideoUrl for composite/split JSON
        if (sceneVideoUrl) {
          try {
            const parsed = JSON.parse(sceneVideoUrl);
            if (parsed?.type === 'composite' && Array.isArray(parsed.assets)) {
              compositePayload = parsed as any;
            } else if (parsed?.type === 'split' && Array.isArray(parsed.urls) && parsed.urls.length >= 2) {
              splitPayload = parsed as any;
            }
          } catch {}
        }

        // Check imageUrl for slideshow JSON
        if (!compositePayload && !splitPayload && url) {
          try {
            const parsed = JSON.parse(url);
            if (parsed?.type === 'slideshow' && Array.isArray(parsed.urls)) {
              slideshowPayload = parsed as any;
            }
          } catch {}
        }

        const isSkipMarker = !url || url === 'SKIP_T2V' || url === 'SKIP_VEO' || url === '';

        // Skip scenes with absolutely nothing to render
        if (isSkipMarker && !sceneVideoUrl && !compositePayload && !splitPayload && !slideshowPayload) return null;

        return (
          <Sequence
            key={i}
            from={contentStart + i * sceneDuration}
            durationInFrames={sceneDuration}
          >
            {compositePayload ? (
              // ── Composite: mixed user assets in exact order ─────────────────
              <CompositeScene
                assets={compositePayload.assets}
                duration={sceneDuration}
                fallbackImageUrl={url}
              />
            ) : splitPayload ? (
              // ── Split-screen: two real user videos side-by-side ─────────────
              <SplitScreenScene
                urls={splitPayload.urls}
                duration={sceneDuration}
                sourceDuration={sourceDurationSec}
                fallbackImageUrl={url}
              />
            ) : slideshowPayload ? (
              // ── Slideshow: cycle N images smoothly ──────────────────────────
              <SlideshowScene
                urls={slideshowPayload.urls}
                duration={sceneDuration}
              />
            ) : sceneVideoUrl ? (
              // ── AI/user video clip ───────────────────────────────────────────
              <VideoClipScene
                videoUrl={sceneVideoUrl}
                imageUrl={url}
                duration={sceneDuration}
                sourceDuration={sourceDurationSec}
              />
            ) : !isSkipMarker ? (
              // ── Static image with ken-burns ──────────────────────────────────
              <VideoScene imageUrl={url} duration={sceneDuration} index={i} />
            ) : (
              <AbsoluteFill style={{ backgroundColor: 'black' }} />
            )}
          </Sequence>
        );
      })}

      {/* Captions: delayed by 2 seconds to sync with audio playback */}
      {captionData?.segments && (
        <Sequence from={contentStart + CAPTION_DELAY_FRAMES} durationInFrames={contentFrames - CAPTION_DELAY_FRAMES}>
          <Captions
            segments={captionData.segments}
            styleId={captionStyle}
            language={language}
          />
        </Sequence>
      )}

      {/* Crossfade bridge: Content → Outro */}
      {outroClip && (
        <Sequence from={outroStart - BRIDGE_FRAMES} durationInFrames={BRIDGE_FRAMES * 2}>
          <CrossfadeBridge durationInFrames={BRIDGE_FRAMES * 2} />
        </Sequence>
      )}

      {/* ══════════════════════════════════════════════════
          OUTRO SECTION — HeyGen avatar clip (English)
      ══════════════════════════════════════════════════ */}
      {outroClip && (
        <Sequence from={outroStart} durationInFrames={outroFrames}>
          <AvatarClipScene videoUrl={outroClip.videoUrl} audioUrl={outroClip.audioUrl} durationInFrames={outroFrames} videoDurationSec={outroClip.videoDurationSec} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
