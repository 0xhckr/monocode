import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { GitBranch } from "../../../shared/ui/icons";
import {
  gitLocateFiles,
  subscribeGitChanged,
  type GitDiffIndex,
} from "../../../platform/tauri/fs";
import { projectKey, projectName } from "../../../shared/lib/paths";
import {
  sessionCheckpointStatus,
  subscribeReviewChanged,
} from "../../sessions/model/checkpoint";
import type { HarnessId } from "../../sessions/model/session";
import { useProjectAppearance } from "../../projects/hooks/useProjectAppearance";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import {
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import { GraphResizeSash } from "../../source-control/ui/GitHistoryGraph";
import {
  MonoProjectCommit,
  useProjectIndex,
  type MonoProjectFile,
} from "./MonoProjectCommit";

const SessionChangesDiff = lazySurface(async () => {
  const module = await import("../../source-control/ui/SessionChangesDiff");
  return { default: module.SessionChangesDiff };
});

/** What the chat asked the view to show; a new object re-applies it. */
export type MonoChangesRequest = { path?: string };

const COMMIT_PANE_DEFAULT = 280;
/** Room the diff keeps above the commit pane, however far it is dragged. */
const DIFF_PANE_MIN = 120;
let commitPaneHeight = COMMIT_PANE_DEFAULT;

/**
 * A Mono's session changes, one tab per project they landed in: the diff on
 * top and, under a sash like the history graph's, the commit and push.
 */
export function MonoChangesView({
  sessionId,
  cwd,
  request,
  textHarness,
}: {
  sessionId: string;
  cwd: string;
  request: MonoChangesRequest;
  textHarness?: HarnessId;
}) {
  const { projects, outside, loaded, error } = useSessionProjects(sessionId, cwd);
  const [focusPath, setFocusPath] = useState(request.path);
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const project =
    projects.find((entry) => entry.root === selectedRoot) ??
    (focusPath
      ? projects.find((entry) =>
          entry.files.some((item) => item.file.path === focusPath),
        )
      : undefined) ??
    projects[0];
  const [indexes, setIndexes] = useState<ReadonlyMap<string, GitDiffIndex | null>>(new Map());
  const updateIndex = useCallback((root: string, index: GitDiffIndex | null) => {
    setIndexes((previous) => previous.get(root) === index ? previous : new Map(previous).set(root, index));
  }, []);
  const paneRef = useRef<HTMLDivElement>(null);
  const [commitHeight, setCommitHeight] = useState(commitPaneHeight);
  const maxCommitHeight = () =>
    Math.max(
      DIFF_PANE_MIN,
      (paneRef.current?.clientHeight ?? COMMIT_PANE_DEFAULT * 2) -
        DIFF_PANE_MIN,
    );

  useEffect(() => {
    setFocusPath(request.path);
    if (request.path) setSelectedRoot(null);
  }, [request]);

  // A shorter window keeps some of the diff in view.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane || pane.clientHeight === 0) return;
    const max = maxCommitHeight();
    if (commitHeight > max) setCommitHeight(max);
  }, [commitHeight]);

  // With one repository the diff shows everything; with several, the
  // selected project's files plus anything outside Git stay together.
  const scope =
    projects.length > 1 && project
      ? [...project.files.map((entry) => entry.file.path), ...outside]
      : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-mono-changes>
      {project ? (
        <ProjectTabs
          projects={projects}
          selected={project.root}
          index={indexes.get(project.root) ?? null}
          onSelect={setSelectedRoot}
        />
      ) : null}
      <div ref={paneRef} className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <SessionChangesDiff
              cwd={cwd}
              sessionId={sessionId}
              focusPath={focusPath}
              paths={scope}
              initialExpansion="first"
            />
          </div>
        </div>
        {project ? (
          <>
            <GraphResizeSash
              height={commitHeight}
              onHeightPaint={setCommitHeight}
              onHeightCommit={(next) => {
                setCommitHeight(next);
                commitPaneHeight = next;
              }}
              maxHeight={maxCommitHeight}
            />
            <div
              className="relative shrink-0 overflow-hidden border-t border-stroke"
              style={{ height: commitHeight }}
            >
              {/* Every checkout stays mounted so its draft survives a switch. */}
              {projects.map((entry) => (
                <div
                  key={`${sessionId}:${cwd}:${entry.root}`}
                  role="tabpanel"
                  aria-label={`Commit ${projectName(entry.root)}`}
                  hidden={entry.root !== project.root}
                  className="absolute inset-0 flex h-full flex-col"
                >
                  <ProjectCommit
                    sessionId={sessionId}
                    cwd={cwd}
                    root={entry.root}
                    files={entry.files}
                    onIndex={updateIndex}
                    textHarness={textHarness}
                    onOpenFile={setFocusPath}
                  />
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="shrink-0 border-t border-stroke px-4 py-2 text-[12px] text-red-400">
          Couldn’t load repositories: {error}
        </p>
      ) : null}
      {loaded && !project && outside.length > 0 ? (
        <p className="shrink-0 border-t border-stroke px-4 py-2 text-[11px] text-content/45">
          These files aren’t in a Git repository, so there’s nothing to commit.
        </p>
      ) : null}
    </div>
  );
}

/** Each checkout stays mounted so its draft, selection and actions survive a switch. */
function ProjectCommit({
  onIndex,
  ...props
}: Omit<ComponentProps<typeof MonoProjectCommit>, "index" | "reloadIndex"> & {
  onIndex: (root: string, index: GitDiffIndex | null) => void;
}) {
  const { index, reload } = useProjectIndex(props.root);
  useEffect(() => onIndex(props.root, index), [props.root, index, onIndex]);
  return <MonoProjectCommit {...props} index={index} reloadIndex={reload} />;
}

/**
 * Every project the work landed in, as a tab with its logo or mascot; the
 * open one's branch sits at the end.
 */
function ProjectTabs({
  projects,
  selected,
  index,
  onSelect,
}: {
  projects: SessionProject[];
  selected: string;
  index: GitDiffIndex | null;
  onSelect: (root: string) => void;
}) {
  const { groupLabels, groupColors, groupCustomColors, groupMascots } =
    useProjectAppearance();
  const groupLogos = useTabGroupLogos();
  return (
    <div className="flex h-9 shrink-0 items-stretch gap-3 border-b border-stroke px-4">
      <div
        role="tablist"
        aria-label="Projects"
        className="flex min-w-0 items-stretch gap-4 overflow-x-auto [scrollbar-width:none]"
      >
        {projects.map(({ root, files }) => {
          const key = projectKey(root);
          const seed = projectName(root);
          const label = resolveTabGroupLabel(key, groupLabels, seed);
          const logoPath = resolveTabGroupLogo(key, groupLogos);
          const active = root === selected;
          return (
            <button
              key={root}
              type="button"
              role="tab"
              aria-selected={active}
              title={root}
              data-mono-project={root}
              onClick={() => onSelect(root)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b text-[12px] font-medium ${
                active
                  ? "border-content text-content"
                  : "border-transparent text-content/50 hover:text-content/80"
              }`}
            >
              {logoPath ? (
                <ProjectLogoIcon
                  path={logoPath}
                  className="size-3.5 shrink-0 rounded-sm"
                  imageClassName="size-3.5"
                />
              ) : (
                <ProjectMascot
                  project={seed}
                  color={resolveTabGroupColor(
                    key,
                    groupColors,
                    groupCustomColors,
                    seed,
                  )}
                  name={resolveTabGroupMascot(key, groupMascots)}
                  className="size-3 shrink-0"
                />
              )}
              <span className="max-w-40 truncate">{label}</span>
              {files.length > 0 ? (
                <span className="tabular-nums text-content/40">
                  {files.length}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {index?.branch ? (
        <span className="ml-auto flex min-w-0 items-center gap-1 text-[11px] font-normal text-content/50">
          <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 truncate">{index.branch}</span>
          {index.ahead > 0 ? (
            <span className="shrink-0 tabular-nums text-content/40">
              ↑{index.ahead}
            </span>
          ) : null}
          {index.behind > 0 ? (
            <span className="shrink-0 tabular-nums text-content/40">
              ↓{index.behind}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

type SessionProject = { root: string; files: MonoProjectFile[] };

/**
 * Group the session's changed files by the repository that holds them. A
 * project stays listed after its files are committed so it can still be pushed.
 */
function useSessionProjects(
  sessionId: string,
  cwd: string,
): { projects: SessionProject[]; outside: string[]; loaded: boolean; error: string | null } {
  const [projects, setProjects] = useState<SessionProject[]>([]);
  const [outside, setOutside] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProjects([]);
    setOutside([]);
    setLoaded(false);
    setError(null);
    if (!cwd || cwd === "~") return;
    let disposed = false;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      void sessionCheckpointStatus(sessionId, cwd)
        .then(async ({ files }) => {
          const locations = await gitLocateFiles(
            files.map((file) => file.path),
          );
          if (disposed || current !== generation) return;
          setError(null);
          const byRoot = new Map<string, MonoProjectFile[]>();
          const loose: string[] = [];
          files.forEach((file, index) => {
            const location = locations[index];
            if (!location) {
              loose.push(file.path);
              return;
            }
            const group = byRoot.get(location.root) ?? [];
            group.push({ file, relative: location.relative });
            byRoot.set(location.root, group);
          });
          setOutside(loose);
          setProjects((previous) => {
            const next = previous.map((project) => ({
              root: project.root,
              files: byRoot.get(project.root) ?? [],
            }));
            for (const [root, group] of byRoot) {
              if (!previous.some((project) => project.root === root)) {
                next.push({ root, files: group });
              }
            }
            return next;
          });
        })
        .catch((caught: unknown) => {
          if (!disposed && current === generation)
            setError(caught instanceof Error ? caught.message : String(caught));
        })
        .finally(() => {
          if (!disposed && current === generation) setLoaded(true);
        });
    };
    load();
    const unsubscribeReview = subscribeReviewChanged((changed) => {
      if (!changed || changed === sessionId) load();
    });
    const unsubscribeGit = subscribeGitChanged(load);
    return () => {
      disposed = true;
      unsubscribeReview();
      unsubscribeGit();
    };
  }, [sessionId, cwd]);

  return { projects, outside, loaded, error };
}
