import { createHash } from "node:crypto";
import { err, ok } from "../result.ts";
import type {
  ImportEntryRejection,
  ImportEntryReport,
  ImportFailure,
  ImportFile,
  ParsedEpisode,
  SubtitleImportInspector,
  SubtitleImportPolicy,
} from "./import-contracts.ts";
import { parseSrt } from "./srt.ts";
import { inspectZip } from "./zip.ts";

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const episodeOrder = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

const safeDirectName = (name: string): boolean =>
  name !== "" &&
  !name.includes("\0") &&
  !name.startsWith("/") &&
  !name.startsWith("\\") &&
  !/^[A-Za-z]:/u.test(name) &&
  !name.split(/[\\/]/u).includes("..");

const rejection = (
  displayName: string,
  reason: ImportEntryRejection,
  detail: string,
): ImportEntryReport => ({ outcome: "rejected", displayName, reason, detail });

export const createSubtitleImportInspector = (
  policy: SubtitleImportPolicy,
): SubtitleImportInspector => ({
  inspect: async (input, pendingImportToken, now) => {
    if (input.mode === "direct" && input.files.length === 0) {
      return err({ kind: "emptyImport" });
    }
    if (input.mode === "direct" && input.files.length > policy.maximumEntries) {
      return err({ kind: "entryLimitExceeded", maximum: policy.maximumEntries });
    }
    if (
      input.mode === "zip" &&
      input.archive.bytes.byteLength > policy.maximumArchiveBytes
    ) {
      return err({ kind: "archiveTooLarge", maximumBytes: policy.maximumArchiveBytes });
    }

    let files: readonly Readonly<{
      file: ImportFile | null;
      report: ImportEntryReport | null;
    }>[];
    if (input.mode === "zip") {
      if (!input.archive.name.toLocaleLowerCase().endsWith(".zip")) {
        return err({
          kind: "mixedImportMode",
          detail: "Archive import requires one .zip file.",
        });
      }
      const archive = inspectZip(input.archive, policy);
      if (!archive.ok) {
        const failure: ImportFailure =
          archive.error.kind === "entryLimitExceeded"
            ? { kind: "entryLimitExceeded", maximum: policy.maximumEntries }
            : archive.error.kind === "inflationLimitExceeded"
              ? {
                  kind: "inflationLimitExceeded",
                  maximumBytes: policy.maximumInflatedBytes,
                }
              : { kind: "corruptArchive", detail: archive.error.detail };
        return err(failure);
      }
      files = archive.value.map((entry) => ({
        file:
          entry.bytes === null ? null : { name: entry.displayName, bytes: entry.bytes },
        report: entry.rejection,
      }));
    } else {
      if (input.files.some((file) => file.name.toLocaleLowerCase().endsWith(".zip"))) {
        return err({
          kind: "mixedImportMode",
          detail: "Select direct SRT files or one ZIP, not both.",
        });
      }
      files = input.files.map((file) => ({ file, report: null }));
    }

    files = [...files].sort((left, right) =>
      episodeOrder.compare(
        left.file?.name ?? left.report?.displayName ?? "",
        right.file?.name ?? right.report?.displayName ?? "",
      ),
    );

    const entries: ImportEntryReport[] = [];
    const episodes: ParsedEpisode[] = [];
    const duplicateByEpisode = new Map<string, string>();
    let decodedTotal = 0;
    for (let index = 0; index < files.length; index += 1) {
      const candidate = files[index];
      if (candidate?.report !== null && candidate?.report !== undefined) {
        entries.push(candidate.report);
        continue;
      }
      const file = candidate?.file;
      if (file === null || file === undefined) continue;
      if (!safeDirectName(file.name)) {
        entries.push(
          rejection(
            file.name || `entry-${index + 1}`,
            "unsafeName",
            "File name is unsafe.",
          ),
        );
        continue;
      }
      if (!file.name.toLocaleLowerCase().endsWith(".srt")) {
        entries.push(
          rejection(file.name, "unsupportedExtension", "Only .srt files are analyzed."),
        );
        continue;
      }
      const entryId = `entry-v1:sha256:${sha256(`${index}\0${file.name}\0${sha256(file.bytes)}`)}`;
      const parsed = parseSrt(entryId, file.name, file.bytes, policy);
      if (!parsed.ok) {
        entries.push(rejection(file.name, parsed.error.reason, parsed.error.detail));
        continue;
      }
      const duplicateOf = duplicateByEpisode.get(parsed.value.episodeKey);
      if (duplicateOf !== undefined) {
        entries.push({
          outcome: "duplicate",
          displayName: file.name,
          reason: "duplicate",
          detail: "Episode cue text duplicates an accepted file.",
          duplicateOf,
        });
        continue;
      }
      decodedTotal += parsed.value.decodedBytes;
      if (decodedTotal > policy.maximumDecodedBytes) {
        return err({
          kind: "decodedLimitExceeded",
          maximumBytes: policy.maximumDecodedBytes,
        });
      }
      duplicateByEpisode.set(parsed.value.episodeKey, parsed.value.entryId);
      episodes.push(parsed.value);
      entries.push({
        outcome: "accepted",
        entryId: parsed.value.entryId,
        displayName: parsed.value.displayName,
        inferredTitle: parsed.value.inferredTitle,
        episodeKey: parsed.value.episodeKey,
        cueCount: parsed.value.cues.length,
        decodedBytes: parsed.value.decodedBytes,
      });
    }
    if (episodes.length === 0) return err({ kind: "noAcceptedFiles" });
    const accepted = entries.filter((entry) => entry.outcome === "accepted").length;
    const duplicates = entries.filter((entry) => entry.outcome === "duplicate").length;
    return ok({
      episodes,
      report: {
        pendingImportToken,
        policyVersion: policy.version,
        expiresAt: new Date(now.getTime() + policy.pendingImportTtlMs).toISOString(),
        entries,
        acceptedCount: accepted,
        duplicateCount: duplicates,
        rejectedCount: entries.length - accepted - duplicates,
      },
    });
  },
});
