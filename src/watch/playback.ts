import { activeWatchCues, type WatchCue } from "./subtitles.ts";

export type LocalPlayback = Readonly<{
  replaceVideo: (file: File) => Readonly<{ url: string; name: string }>;
  replaceAudio: (file: File) => string;
  clearAudio: () => void;
  cuesAt: (
    cues: readonly WatchCue[],
    currentTimeSeconds: number,
  ) => readonly WatchCue[];
  dispose: () => void;
}>;

export type ObjectUrlPort = Readonly<{
  create: (file: File) => string;
  revoke: (url: string) => void;
}>;

export const createLocalPlayback = (objectUrls: ObjectUrlPort): LocalPlayback => {
  let videoUrl: string | null = null;
  let audioUrl: string | null = null;
  const clearAudio = (): void => {
    if (audioUrl !== null) objectUrls.revoke(audioUrl);
    audioUrl = null;
  };
  return {
    replaceVideo: (file) => {
      if (videoUrl !== null) objectUrls.revoke(videoUrl);
      clearAudio();
      videoUrl = objectUrls.create(file);
      return { url: videoUrl, name: file.name };
    },
    replaceAudio: (file) => {
      clearAudio();
      audioUrl = objectUrls.create(file);
      return audioUrl;
    },
    clearAudio,
    cuesAt: (cues, currentTimeSeconds) =>
      activeWatchCues(cues, Math.round(currentTimeSeconds * 1_000)),
    dispose: () => {
      if (videoUrl !== null) objectUrls.revoke(videoUrl);
      videoUrl = null;
      clearAudio();
    },
  };
};
