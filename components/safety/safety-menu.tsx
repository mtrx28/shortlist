"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ShieldAlert } from "lucide-react";
import {
  blockUserAction,
  endKeptChatAction,
  reportUserAction,
} from "@/app/safety/actions";
import { Button } from "@/components/ui/button";
import { CLOSE_TEMPLATES } from "@/config/conversation";
import { REPORT_REASONS } from "@/config/safety";

// The safety menu: report, block, and (for a kept chat) end it kindly. It is
// used on every intro card and on the chat screen. Nothing happens until the
// person confirms, and after each action it says in plain words what happens
// next. All the real work is done on the server (app/safety/actions.ts).

type Mode = "closed" | "menu" | "report" | "block" | "end" | "done";

export function SafetyMenu({
  targetId,
  targetName,
  conversationId = null,
  chatStatus = null,
}: {
  targetId: string;
  targetName: string;
  conversationId?: string | null;
  chatStatus?: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("closed");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  // The report form
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [attach, setAttach] = useState(false);
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [template, setTemplate] = useState<string>(CLOSE_TEMPLATES[0].id);

  const finish = (r: { ok: boolean; message: string }) => {
    setResult({ ok: r.ok, text: r.message });
    setMode("done");
  };

  const submitReport = () => {
    if (!reason) {
      setResult({ ok: false, text: "Please pick a reason first." });
      return;
    }
    setResult(null);
    startTransition(async () => {
      finish(
        await reportUserAction({
          targetId,
          conversationId,
          reason,
          details,
          attach: attach && Boolean(conversationId),
          alsoBlock,
        }),
      );
    });
  };

  const submitBlock = () => {
    startTransition(async () => finish(await blockUserAction({ targetId })));
  };

  const submitEnd = () => {
    if (!conversationId) return;
    startTransition(async () =>
      finish(await endKeptChatAction({ conversationId, templateId: template })),
    );
  };

  if (mode === "closed") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setMode("menu")}
        aria-label={`Safety options for ${targetName}`}
      >
        <ShieldAlert aria-hidden />
        Safety
      </Button>
    );
  }

  return (
    <div
      role="group"
      aria-label={`Safety options for ${targetName}`}
      className="bg-background space-y-3 rounded-lg border p-4 text-sm"
    >
      {mode === "menu" && (
        <>
          <p className="font-medium">Safety options for {targetName}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setMode("report")}
            >
              Report
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMode("block")}
            >
              Block
            </Button>
            {chatStatus === "kept" && conversationId && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setMode("end")}
              >
                End this chat
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMode("closed")}
            >
              Cancel
            </Button>
          </div>
        </>
      )}

      {mode === "block" && (
        <>
          <p className="font-medium">Block {targetName}?</p>
          <p className="text-muted-foreground">
            You will not see each other again and you will not be matched. Any
            chat between you ends right away and its slot is free again. They
            are not told that you blocked them. This cannot be undone from the
            app.
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={submitBlock} disabled={pending}>
              {pending ? "Blocking..." : "Yes, block"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMode("menu")}
            >
              Back
            </Button>
          </div>
        </>
      )}

      {mode === "end" && (
        <>
          <p className="font-medium">End this chat with {targetName}?</p>
          <p className="text-muted-foreground">
            This closes the chat for both of you. They will see the kind note
            you pick below, nothing else. Your chat slot becomes free again.
          </p>
          <fieldset className="space-y-1">
            <legend className="mb-1 font-medium">Note for them</legend>
            {CLOSE_TEMPLATES.map((t) => (
              <label key={t.id} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="end-template"
                  value={t.id}
                  checked={template === t.id}
                  onChange={() => setTemplate(t.id)}
                  className="mt-1"
                />
                <span>{t.label}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2">
            <Button type="button" onClick={submitEnd} disabled={pending}>
              {pending ? "Ending..." : "End this chat"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMode("menu")}
            >
              Back
            </Button>
          </div>
        </>
      )}

      {mode === "report" && (
        <>
          <p className="font-medium">Report {targetName}</p>
          <p className="text-muted-foreground">
            A person on our team reads every report. They are not told it was
            you. You can also block them below.
          </p>
          <label className="block space-y-1">
            <span className="font-medium">What happened?</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="bg-background w-full rounded-md border px-2 py-2"
            >
              <option value="">Choose a reason</option>
              {REPORT_REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-medium">
              Anything else we should know? (optional)
            </span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
              rows={3}
              className="bg-background w-full rounded-md border px-2 py-2"
            />
          </label>
          {conversationId && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={attach}
                onChange={(e) => setAttach(e.target.checked)}
                className="mt-1"
              />
              <span>
                Include the last 20 messages of this chat as evidence. Only our
                moderators can open them, and we log when they do.
              </span>
            </label>
          )}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={alsoBlock}
              onChange={(e) => setAlsoBlock(e.target.checked)}
              className="mt-1"
            />
            <span>Also block them</span>
          </label>
          {result && !result.ok && (
            <p role="alert" className="text-destructive">
              {result.text}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={submitReport} disabled={pending}>
              {pending ? "Sending..." : "Send report"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMode("menu")}
            >
              Back
            </Button>
          </div>
        </>
      )}

      {mode === "done" && result && (
        <>
          <p
            role={result.ok ? "status" : "alert"}
            className={result.ok ? "" : "text-destructive"}
          >
            {result.text}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const ok = result.ok;
              setMode(ok ? "closed" : "menu");
              setResult(null);
              // Show what the action changed (a blocked person's card goes away).
              if (ok) router.refresh();
            }}
          >
            {result.ok ? "Close" : "Back"}
          </Button>
        </>
      )}
    </div>
  );
}
