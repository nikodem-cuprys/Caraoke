"use client";

import {
  PLAYBACK_SPEEDS,
  computeLineLoopRegion,
  computeSectionLoopRegion,
  findActiveLine,
  findNextLine,
  findPreviousLine,
  nextLoopSeekTime,
  rewindBySeconds,
  speedToPlaybackRate,
  type LoopRegion,
  type LyricLineDTO,
  type PlaybackSpeed,
  type SongDTO,
  type SongSectionDTO,
} from "@singlearn/shared";
import { useCallback, useEffect, useRef, useState } from "react";

export type MixerPreset = "original" | "learn" | "practice" | "karaoke" | "custom";

const MIXER_PRESETS: Record<Exclude<MixerPreset, "custom">, { vocals: number; instrumental: number }> = {
  original: { vocals: 1, instrumental: 1 },
  learn: { vocals: 1, instrumental: 0.4 },
  practice: { vocals: 0.35, instrumental: 1 },
  karaoke: { vocals: 0, instrumental: 1 },
};

export interface LoopState {
  kind: "line" | "section" | null;
  region: LoopRegion | null;
  prerollSec: number;
}

const DRIFT_CORRECTION_THRESHOLD_SEC = 0.12;

export function usePlayer(song: SongDTO) {
  const referenceRef = useRef<HTMLAudioElement | null>(null);
  const vocalsRef = useRef<HTMLAudioElement | null>(null);
  const instrumentalRef = useRef<HTMLAudioElement | null>(null);

  const stemsAvailable = song.assets.separationAvailable && !!song.assets.vocals && !!song.assets.instrumental;

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState<PlaybackSpeed>(1.0);
  const [mixerPreset, setMixerPresetState] = useState<MixerPreset>("original");
  const [vocalsVolume, setVocalsVolume] = useState(1);
  const [instrumentalVolume, setInstrumentalVolume] = useState(1);
  const [loop, setLoop] = useState<LoopState>({ kind: null, region: null, prerollSec: 1.5 });

  const primary = useCallback((): HTMLAudioElement | null => {
    return stemsAvailable ? vocalsRef.current : referenceRef.current;
  }, [stemsAvailable]);

  // Apply mixer volumes to the underlying elements.
  useEffect(() => {
    if (vocalsRef.current) vocalsRef.current.volume = vocalsVolume;
    if (instrumentalRef.current) instrumentalRef.current.volume = instrumentalVolume;
  }, [vocalsVolume, instrumentalVolume]);

  // Apply playback rate to whichever elements exist. Browsers preserve
  // pitch by default when changing playbackRate (preservesPitch defaults
  // to true), so slow-practice speeds don't need separate pitch shifting.
  useEffect(() => {
    const rate = speedToPlaybackRate(playbackRate);
    for (const ref of [referenceRef, vocalsRef, instrumentalRef]) {
      if (ref.current) ref.current.playbackRate = rate;
    }
  }, [playbackRate]);

  const play = useCallback(() => {
    referenceRef.current?.play().catch(() => {});
    vocalsRef.current?.play().catch(() => {});
    instrumentalRef.current?.play().catch(() => {});
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    referenceRef.current?.pause();
    vocalsRef.current?.pause();
    instrumentalRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(t, song.durationSec));
    for (const ref of [referenceRef, vocalsRef, instrumentalRef]) {
      if (ref.current) ref.current.currentTime = clamped;
    }
    setCurrentTime(clamped);
  }, [song.durationSec]);

  const setPlaybackRate = useCallback((speed: PlaybackSpeed) => setPlaybackRateState(speed), []);

  const applyMixerPreset = useCallback((preset: Exclude<MixerPreset, "custom">) => {
    const values = MIXER_PRESETS[preset];
    setVocalsVolume(values.vocals);
    setInstrumentalVolume(values.instrumental);
    setMixerPresetState(preset);
  }, []);

  const setCustomVolumes = useCallback((vocals: number, instrumental: number) => {
    setVocalsVolume(vocals);
    setInstrumentalVolume(instrumental);
    setMixerPresetState("custom");
  }, []);

  const clearLoop = useCallback(() => setLoop((l) => ({ ...l, kind: null, region: null })), []);

  const loopLine = useCallback(
    (line: LyricLineDTO, prerollSec = loop.prerollSec) => {
      const prevLine = findPreviousLine(song.lines, line.start);
      const region = computeLineLoopRegion(line, prerollSec, song.durationSec, prevLine?.end ?? 0);
      setLoop({ kind: "line", region, prerollSec });
      seek(region.start);
    },
    [loop.prerollSec, seek, song.durationSec, song.lines]
  );

  const loopSection = useCallback(
    (section: SongSectionDTO, prerollSec = loop.prerollSec) => {
      const region = computeSectionLoopRegion(section, prerollSec, song.durationSec);
      setLoop({ kind: "section", region, prerollSec });
      seek(region.start);
    },
    [loop.prerollSec, seek, song.durationSec]
  );

  const loopRegion = useCallback(
    (region: LoopRegion, prerollSec = loop.prerollSec) => {
      const start = Math.max(0, region.start - prerollSec);
      const end = Math.min(song.durationSec, region.end);
      setLoop({ kind: "section", region: { start, end }, prerollSec });
      seek(start);
    },
    [loop.prerollSec, seek, song.durationSec]
  );

  const setLoopPreroll = useCallback((prerollSec: number) => setLoop((l) => ({ ...l, prerollSec })), []);

  const activeLine = findActiveLine(song.lines, currentTime);

  const previousLine = useCallback(() => {
    const prev = findPreviousLine(song.lines, activeLine ? activeLine.start : currentTime);
    if (prev) seek(prev.start);
  }, [activeLine, currentTime, seek, song.lines]);

  const nextLine = useCallback(() => {
    const next = findNextLine(song.lines, currentTime);
    if (next) seek(next.start);
  }, [currentTime, seek, song.lines]);

  const rewind5 = useCallback(() => seek(rewindBySeconds(currentTime, 5)), [currentTime, seek]);

  const replayCurrentLine = useCallback(() => {
    if (activeLine) seek(activeLine.start);
  }, [activeLine, seek]);

  // Canonical timeline: one rAF loop reads the primary element's
  // currentTime, applies loop-boundary seeking, and (when playing separated
  // stems) periodically re-syncs the secondary element if it has drifted.
  useEffect(() => {
    let raf: number;
    const tick = () => {
      const el = primary();
      if (el) {
        const t = el.currentTime;
        setCurrentTime(t);

        if (loop.region) {
          const seekTo = nextLoopSeekTime(t, loop.region);
          if (seekTo !== null) {
            seek(seekTo);
          }
        }

        if (stemsAvailable && instrumentalRef.current) {
          const drift = Math.abs(instrumentalRef.current.currentTime - t);
          if (drift > DRIFT_CORRECTION_THRESHOLD_SEC) {
            instrumentalRef.current.currentTime = t;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [primary, loop.region, seek, stemsAvailable]);

  return {
    refs: { referenceRef, vocalsRef, instrumentalRef },
    stemsAvailable,
    currentTime,
    isPlaying,
    playbackRate,
    playbackSpeeds: PLAYBACK_SPEEDS,
    mixerPreset,
    vocalsVolume,
    instrumentalVolume,
    loop,
    activeLine,
    play,
    pause,
    seek,
    setPlaybackRate,
    applyMixerPreset,
    setCustomVolumes,
    loopLine,
    loopSection,
    loopRegion,
    clearLoop,
    setLoopPreroll,
    previousLine,
    nextLine,
    rewind5,
    replayCurrentLine,
    setIsPlayingFromEvent: setIsPlaying,
  };
}
