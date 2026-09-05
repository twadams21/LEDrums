import { assertProjectIntegrity, blockingRoutingIssues, parseProject, validateRouting, type ProjectPatch, type voice } from '@ledrums/core';
import type { SnapshotFiles } from './backups/snapshot-store';
import type { EngineHost } from './engine-host';
import type { VoiceEngineHost } from './voice-engine-host';
import { SerialQueue } from './serial-queue';
import { selectionFromLibrary, showFromLibraries, validateLibraryVersions } from './project-show';

export interface ProjectReplacementDeps {
  host: EngineHost;
  voiceHost: VoiceEngineHost | null;
  readCurrent(): SnapshotFiles;
  safetySnapshot(): Promise<boolean>;
  flushAutosaves(): Promise<void>;
  persist(files: SnapshotFiles): Promise<void>;
  /** Must only assign the validated slots; no callbacks/IO inside the commit. */
  commitLibraries(files: SnapshotFiles): void;
  broadcastState(): void;
  isShuttingDown?(): boolean;
}

export function validateSnapshotFiles(files: SnapshotFiles): SnapshotFiles & { project: ReturnType<typeof parseProject> } {
  const project = parseProject(files.project);
  assertProjectIntegrity(project);
  const issues = blockingRoutingIssues(validateRouting(project.kit, project.kit.outputs));
  if (issues.length) throw new Error(`Invalid project routing: ${issues[0]!.message}`);
  validateLibraryVersions(files.showLibrary, files.songLibrary);
  return { ...files, project };
}

/** Sole full-replacement transaction. Preflight is side-effect free; all fallible slow work
 * precedes the synchronous pointer commit. Frames continue on the OLD runtime during IO.
 * Callers serialize ordinary authoring with this operation, not hardware input or frame ticks. */
export function createProjectReplacement(deps: ProjectReplacementDeps) {
  const queue = new SerialQueue();
  async function replace(files: SnapshotFiles, preserveShow: boolean): Promise<void> {
    const next = validateSnapshotFiles(files);
    const old = deps.readCurrent();
    const legacy = deps.host.prepareProject(next.project);
    const show: voice.Show | null = preserveShow ? deps.voiceHost?.getShow() ?? null
      : showFromLibraries(next.showLibrary, next.songLibrary);
    const voiceStage = deps.voiceHost?.prepareProject(next.project, show,
      preserveShow ? undefined : selectionFromLibrary(next.showLibrary));
    if (!await deps.safetySnapshot()) throw new Error('Backup failed — replacement refused (no recovery snapshot)');
    await deps.flushAutosaves();
    await deps.persist(next);
    try {
      // The inactive legacy manager must never arm a second UDP sender in voice mode.
      if (!deps.isShuttingDown?.()) (voiceStage ?? legacy).applyOutput();
    } catch (error) {
      // Unexpected collaborator exception, not ordinary UDP failure (reported by the manager).
      // Live pointers still address old state. Restore disk before reporting failure.
      await deps.persist(old);
      (deps.voiceHost ?? deps.host).reloadOutputSettings();
      throw error;
    }
    legacy.commit();
    voiceStage?.commit();
    deps.commitLibraries(next);
    // Exactly one unsolicited sync, after BOTH hosts + durable state agree.
    deps.broadcastState();
  }
  return {
    load(project: unknown): Promise<void> {
      const captured = structuredClone(project);
      return queue.run(() => replace({ ...deps.readCurrent(), project: captured }, true));
    },
    restore(files: SnapshotFiles): Promise<void> {
      const captured = structuredClone(files);
      return queue.run(() => replace(captured, false));
    },
    patch(patch: ProjectPatch): Promise<void> {
      const captured = structuredClone(patch);
      return queue.run(() => {
        const current = deps.readCurrent();
        const project = deps.host.engine.getProject();
        return replace({ ...current, project: { ...project, ...captured, name: captured.name ?? project.name } }, true);
      });
    },
    drain: () => queue.drain(),
    close: () => queue.close(),
  };
}
