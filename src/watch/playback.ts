import { activeWatchCues, type WatchCue } from "./subtitles.ts";

export type LocalPlayback = Readonly<{
  replaceVideo: (file: File) => Readonly<{ url: string; name: string }>;
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
  let currentUrl: string | null = null;
  return {
    replaceVideo: (file) => {
      if (currentUrl !== null) objectUrls.revoke(currentUrl);
      currentUrl = objectUrls.create(file);
      return { url: currentUrl, name: file.name };
    },
    cuesAt: (cues, currentTimeSeconds) =>
      activeWatchCues(cues, Math.round(currentTimeSeconds * 1_000)),
    dispose: () => {
      if (currentUrl !== null) objectUrls.revoke(currentUrl);
      currentUrl = null;
    },
  };
};
