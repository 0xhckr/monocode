import { useEffect, useState, type ReactNode } from "react";
import { projectName } from "../../../shared/lib/paths";
import { IconButton } from "../../../app/shell/TitleBar";
import {
  ChevronRight,
  ExternalLink,
  PanelRightToggle,
} from "../../../shared/ui/icons";
import {
  getSession,
  listSessionsByProject,
  type SessionSummary,
} from "../../sessions/data/sessionStore";
import { summaryFromSession } from "../../sessions/data/sessionHistory";
import { resolveModel } from "../../sessions/model/models";
import {
  hasPendingApproval,
  sessionDisplayTitle,
  sessionDraftBlock,
  type MonoSpawnedSession,
  type Session,
} from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { SessionCard } from "../../../app/shell/Sidebar";
import type { MonoLook } from "../model/mono";
import { PageHeader } from "./monoPanelParts";

/** A launched session open over the overview, live and fully usable. */
export type ShownMonoSession = {
  sessionId: string;
  title: string;
  /** The session's pane. */
  pane: ReactNode;
};

/** Cards for launched sessions, with where each stands, open or saved. */
export function MonoSessionList({
  agent,
  launches,
  sessions,
  history = [],
  onOpenSession,
}: {
  agent: MonoLook;
  launches: readonly MonoSpawnedSession[];
  sessions: readonly Session[];
  history?: readonly SessionSummary[];
  onOpenSession: (sessionId: string) => void | Promise<void>;
}) {
  const launchesKey = JSON.stringify(
    launches.map((entry) => [entry.sessionId, entry.cwd]),
  );
  // Refresh saved status when a launched session closes, archives or moves.
  const liveSessionsKey = JSON.stringify(
    launches.map((launch) => {
      const session = sessions.find((entry) => entry.id === launch.sessionId);
      return session ? [session.id, session.cwd] : null;
    }),
  );
  const [stored, setStored] = useState<{
    byId: Map<string, SessionSummary>;
    loaded: Set<string>;
    failed: Set<string>;
  }>({ byId: new Map(), loaded: new Set(), failed: new Set() });
  const [opening, setOpening] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    const refs: [string, string][] = JSON.parse(launchesKey);
    const projects = [...new Set(refs.map(([, cwd]) => cwd))];
    void Promise.allSettled(
      projects.map((cwd) => listSessionsByProject(cwd)),
    ).then(async (results) => {
      if (cancelled) return;
      const byId = new Map<string, SessionSummary>();
      const loaded = new Set<string>();
      const failed = new Set<string>();
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") {
          failed.add(projects[index]);
          return;
        }
        loaded.add(projects[index]);
        result.value.forEach((session) => byId.set(session.id, session));
      });
      // Project membership can change after launch; the session id stays stable.
      const missing = refs.filter(
        ([id, cwd]) => !byId.has(id) && loaded.has(cwd),
      );
      const restored = await Promise.allSettled(
        missing.map(([id]) => getSession(id)),
      );
      if (cancelled) return;
      restored.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value) {
          byId.set(result.value.id, summaryFromSession(result.value));
        } else if (result.status === "rejected") {
          loaded.delete(missing[index][1]);
          failed.add(missing[index][1]);
        }
      });
      setStored({ byId, loaded, failed });
    });
    return () => {
      cancelled = true;
    };
  }, [launchesKey, liveSessionsKey]);

  const open = async (id: string) => {
    setOpening(id);
    setError(undefined);
    try {
      await onOpenSession(id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not open this session.",
      );
    } finally {
      setOpening(undefined);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-1">
        {launches.map((launch) => {
          const live = sessions.find((entry) => entry.id === launch.sessionId);
          const saved =
            history.find((entry) => entry.id === launch.sessionId) ??
            stored.byId.get(launch.sessionId);
          const unavailable = !live && !saved && stored.loaded.has(launch.cwd);
          // Once it is known, it gets the sidebar's own card: model, status,
          // title, branch or worktree, and any linked PR or issue.
          const summary: SessionSummary | undefined = live
            ? {
                ...saved,
                ...summaryFromSession(live, saved),
                updatedAt: saved?.updatedAt ?? Date.now(),
              }
            : saved;
          if (summary)
            return (
              <div key={launch.sessionId} data-mono-session={launch.sessionId}>
                <SessionCard
                  session={summary}
                  isActive={false}
                  isSelected={false}
                  busy={!!live?.busy}
                  done={false}
                  linkedUpdate={false}
                  needsApproval={
                    !!live &&
                    (hasPendingApproval(live.blocks) || !!live.pendingQuestion)
                  }
                  project={
                    agent.projects.find(
                      (project) => project.path === summary.cwd,
                    )?.name ?? projectName(summary.cwd)
                  }
                  now={Date.now()}
                  onSelect={(id) => {
                    if (!opening) void open(id);
                  }}
                />
              </div>
            );
          const session = live ?? saved;
          const harness = session?.harness ?? launch.harness;
          const model = resolveModel(
            harness,
            session?.model ?? launch.model,
          ).name;
          const title = sessionDisplayTitle(
            session?.title ?? launch.title,
            harness,
          );
          const status = unavailable
            ? "No longer available"
            : live && (hasPendingApproval(live.blocks) || live.pendingQuestion)
              ? "Needs input"
              : live?.busy
                ? "Working"
                : saved?.archived
                  ? "Archived"
                  : (live ? !!sessionDraftBlock(live) : saved?.draft)
                    ? "Draft"
                    : session
                      ? "Ready"
                      : stored.failed.has(launch.cwd)
                        ? "Status unavailable"
                        : "Loading…";
          return (
            <button
              key={launch.sessionId}
              type="button"
              data-mono-session={launch.sessionId}
              disabled={unavailable || !!opening}
              onClick={() => void open(launch.sessionId)}
              className="group flex w-full items-center gap-2 rounded-lg border border-stroke bg-content/3 px-3 py-2.5 text-left outline-none hover:border-content/20 hover:bg-content/6 focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-content">
                  {title}
                </p>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-content/45">
                  <HarnessIcon harness={harness} className="size-3 shrink-0" />
                  <span className="truncate">{model}</span>
                  <span aria-hidden>·</span>
                  <span className="truncate" title={session?.cwd ?? launch.cwd}>
                    {agent.projects.find(
                      (project) =>
                        project.path === (session?.cwd ?? launch.cwd),
                    )?.name ?? projectName(session?.cwd ?? launch.cwd)}
                  </span>
                </div>
                <p
                  className="mt-2 flex items-center gap-1.5 text-[11px] text-content/55"
                  role="status"
                >
                  <span
                    aria-hidden
                    className={`size-1.5 rounded-full ${status === "Working" ? "animate-pulse bg-[var(--mono-color)]" : status === "Needs input" ? "bg-amber-500/70" : "bg-content/30"}`}
                  />
                  {opening === launch.sessionId ? "Opening…" : status}
                </p>
              </div>
              <ChevronRight
                aria-hidden
                className="size-3.5 shrink-0 text-content/30 group-hover:text-content/60"
              />
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="px-1 pt-3 text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A launched session open over the overview, live and fully usable. */
export function LaunchedSessionPage({
  title,
  onBack,
  onOpenInWorkspace,
  onClose,
  children,
}: {
  title: string;
  onBack: () => void;
  onOpenInWorkspace: () => void | Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [error, setError] = useState<string>();
  return (
    <>
      <PageHeader title={title} onBack={onBack}>
        <IconButton
          label="Open in workspace"
          onClick={() => {
            setError(undefined);
            void Promise.resolve(onOpenInWorkspace()).catch((cause) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not open this session.",
              ),
            );
          }}
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Hide overview" active onClick={onClose}>
          <PanelRightToggle className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      </PageHeader>
      {error ? (
        <p role="alert" className="px-4 pt-2 text-xs text-red-400">
          {error}
        </p>
      ) : null}
      <div
        data-mono-launched-session=""
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {children}
      </div>
    </>
  );
}
