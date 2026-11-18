import { describe, expect, it } from "vitest";
import {
  addIncoming,
  addIncomingMany,
  addPending,
  confirmPending,
  failPending,
  newestSentAt,
  removePending,
  retryPending,
  type ChatMessage,
} from "@/lib/conversation/thread-state";

const msg = (id: string, at: string, sender = "o", body = id) => ({
  id,
  senderId: sender,
  body,
  createdAt: `2026-11-18T10:00:${at}Z`,
});
const NOW = new Date("2026-11-18T10:05:00Z");
const ids = (list: ChatMessage[]) => list.map((m) => m.id);

describe("incoming messages", () => {
  it("adds in time order", () => {
    let list: ChatMessage[] = [];
    list = addIncoming(list, msg("b", "20"));
    list = addIncoming(list, msg("a", "10"));
    list = addIncoming(list, msg("c", "30"));
    expect(ids(list)).toEqual(["a", "b", "c"]);
  });

  it("ignores a message it already has (dedupe by id)", () => {
    const once = addIncoming([], msg("a", "10"));
    expect(addIncoming(once, msg("a", "10"))).toBe(once);
    expect(
      addIncomingMany(once, [msg("a", "10"), msg("b", "11")]),
    ).toHaveLength(2);
  });

  it("breaks ties on the same time by id so the order is stable", () => {
    const list = addIncomingMany([], [msg("z", "10"), msg("a", "10")]);
    expect(ids(list)).toEqual(["a", "z"]);
  });

  it("keeps sending messages at the end", () => {
    let list = addPending([], "local-1", "me", "typing", NOW);
    list = addIncoming(list, msg("x", "59", "them"));
    expect(ids(list)).toEqual(["x", "local-1"]);
  });
});

describe("sending", () => {
  it("shows the message at once as sending", () => {
    const list = addPending([], "local-1", "me", "hello", NOW);
    expect(list).toEqual([
      {
        id: "local-1",
        senderId: "me",
        body: "hello",
        createdAt: NOW.toISOString(),
        status: "sending",
      },
    ]);
  });

  it("swaps in the real id when the server confirms", () => {
    let list = addPending([], "local-1", "me", "hello", NOW);
    list = confirmPending(list, "local-1", {
      id: "real-1",
      createdAt: "2026-11-18T10:05:01Z",
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "real-1",
      status: "sent",
      body: "hello",
      createdAt: "2026-11-18T10:05:01Z",
    });
  });

  it("does not show the message twice when realtime beats the server reply", () => {
    let list = addPending([], "local-1", "me", "hello", NOW);
    // The realtime event arrives first...
    list = addIncoming(list, msg("real-1", "01", "me", "hello"));
    expect(list).toHaveLength(2); // the temporary one is still there
    // ...then the server reply: the temporary entry is dropped.
    list = confirmPending(list, "local-1", {
      id: "real-1",
      createdAt: "2026-11-18T10:00:01Z",
    });
    expect(ids(list)).toEqual(["real-1"]);
  });

  it("does not show it twice when the server reply comes first", () => {
    let list = addPending([], "local-1", "me", "hello", NOW);
    list = confirmPending(list, "local-1", {
      id: "real-1",
      createdAt: "2026-11-18T10:00:01Z",
    });
    list = addIncoming(list, msg("real-1", "01", "me", "hello"));
    expect(ids(list)).toEqual(["real-1"]);
  });

  it("confirming something that is gone does nothing", () => {
    const list = addIncoming([], msg("a", "10"));
    expect(confirmPending(list, "local-9", { id: "r", createdAt: "x" })).toBe(
      list,
    );
  });

  it("marks a failed send, lets it be retried, and lets it be removed", () => {
    let list = addPending([], "local-1", "me", "hello", NOW);
    list = failPending(list, "local-1");
    expect(list[0].status).toBe("failed");
    list = retryPending(list, "local-1");
    expect(list[0].status).toBe("sending");
    list = failPending(list, "local-1");
    list = removePending(list, "local-1");
    expect(list).toEqual([]);
  });

  it("never removes or fails a message that is really saved", () => {
    const list = addIncoming([], msg("a", "10"));
    expect(removePending(list, "a")).toEqual(list);
    expect(failPending(list, "a")).toEqual(list);
    expect(retryPending(list, "a")).toEqual(list);
  });
});

describe("newestSentAt", () => {
  it("is null for an empty list or only unsent messages", () => {
    expect(newestSentAt([])).toBeNull();
    expect(newestSentAt(addPending([], "l", "me", "x", NOW))).toBeNull();
  });

  it("is the newest saved message, ignoring ones still sending", () => {
    let list = addIncomingMany([], [msg("a", "10"), msg("b", "40")]);
    list = addPending(list, "l", "me", "x", new Date("2026-11-18T11:00:00Z"));
    expect(newestSentAt(list)).toBe("2026-11-18T10:00:40Z");
  });
});
