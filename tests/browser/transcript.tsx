import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { MonoComposer } from "../../src/features/monos/ui/MonoComposer";
import type { Block } from "../../src/features/sessions/model/session";
import {
  saveTranscriptAnchor,
  saveTranscriptLayout,
} from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

saveTranscriptAnchor(false);
saveTranscriptLayout("chat");

// Settled plain text isolates layout during scrolling from streaming, image
// loading and asynchronous syntax highlighting. Turns deliberately vary in size.
const blocks: Block[] = Array.from({ length: 20 }, (_, index): Block[] => [
  {
    id: `user-${index}`,
    role: "user",
    text: `Prompt ${index}: explain this behavior and preserve my place while reading.`,
  },
  {
    id: `reply-${index}`,
    role: "assistant",
    text: Array.from(
      { length: 8 + (index % 5) * 8 },
      (_, paragraph) =>
        `Paragraph ${paragraph}. This is a settled answer with enough text to exercise variable message heights.`,
    ).join("\n\n"),
  },
]).flat();

// Like the transcript pool, parking detaches the transcript from the page.
const root = document.getElementById("root")!;
const host = document.createElement("div");
host.className = "contents";
root.appendChild(host);

function Fixture() {
  const [parked, setParked] = useState(false);
  useEffect(() => {
    Object.assign(window, {
      parkTranscript: () => {
        host.remove();
        setParked(true);
      },
      showTranscript: () => {
        root.appendChild(host);
        setParked(false);
      },
    });
  }, []);
  return (
    <AgentTranscript
      blocks={blocks}
      initialTurns={20}
      visible={!parked}
      parked={parked}
    />
  );
}

const monoAnswer =
  "A reply arriving in chunks that should glide smoothly as the conversation grows. ".repeat(
    35,
  );

function MonoFixture() {
  const history = blocks.slice(-12);
  const prompt: Block = {
    id: "mono-prompt",
    role: "user",
    text: "Explain this in detail",
  };
  const [busy, setBusy] = useState(true);
  const [conversation, setConversation] = useState<Block[]>([
    ...history,
    prompt,
    { id: "mono-answer", role: "assistant", text: monoAnswer, streaming: true },
  ]);
  useEffect(() => {
    Object.assign(window, {
      completeMonoReply: (text = monoAnswer) => {
        setConversation([
          ...history,
          prompt,
          { id: "mono-answer", role: "assistant", text, streaming: false },
        ]);
        setBusy(false);
      },
    });
  }, []);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <AgentTranscript
          blocks={conversation}
          busy={busy}
          agentName="Mono"
          agentMascot={{ mascot: "crab", color: "#aaf" }}
          bottomAligned
          inlineWork
        />
      </div>
      <MonoComposer
        sessionId="browser-mono"
        name="Mono"
        enabled={false}
        onSubmit={() => false}
        controls={<span className="h-6.5">Model · Effort · Context</span>}
      />
    </div>
  );
}

const mono = new URLSearchParams(location.search).has("mono");
if (mono) root.style.width = "540px";
createRoot(host).render(mono ? <MonoFixture /> : <Fixture />);
