// The message list on the chat screen, as plain functions so the tricky parts
// (a message arriving twice, a send that fails, the realtime event beating the
// server reply) can be tested without a browser.
//
// Every message has an id. Messages that came from the database have their
// real id and status "sent". A message you just typed shows at once with a
// temporary id (the "client id") and status "sending"; when the server
// replies, it is swapped for the real one. If the realtime event for that
// same message arrives first, the real one is already in the list and the
// temporary one is simply dropped. So the same message never shows twice.

export type ChatMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string; // ISO time
  status: "sent" | "sending" | "failed";
};

function byTime(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Sent messages in time order, then the ones still sending or failed (in the
// order they were typed).
function arrange(list: ChatMessage[]): ChatMessage[] {
  const sent = list.filter((m) => m.status === "sent").sort(byTime);
  const pending = list.filter((m) => m.status !== "sent");
  return [...sent, ...pending];
}

// A message that came from the database (first load, realtime or polling).
export function addIncoming(
  list: ChatMessage[],
  incoming: Omit<ChatMessage, "status">,
): ChatMessage[] {
  if (list.some((m) => m.id === incoming.id)) return list;
  return arrange([...list, { ...incoming, status: "sent" }]);
}

export function addIncomingMany(
  list: ChatMessage[],
  incoming: Omit<ChatMessage, "status">[],
): ChatMessage[] {
  return incoming.reduce((acc, m) => addIncoming(acc, m), list);
}

// The message you just typed, shown before the server has answered.
export function addPending(
  list: ChatMessage[],
  clientId: string,
  senderId: string,
  body: string,
  now: Date,
): ChatMessage[] {
  return arrange([
    ...list,
    {
      id: clientId,
      senderId,
      body,
      createdAt: now.toISOString(),
      status: "sending",
    },
  ]);
}

// The server accepted it: swap the temporary id for the real one.
export function confirmPending(
  list: ChatMessage[],
  clientId: string,
  real: { id: string; createdAt: string },
): ChatMessage[] {
  const without = list.filter((m) => m.id !== clientId);
  if (without.some((m) => m.id === real.id)) return arrange(without);
  const pending = list.find((m) => m.id === clientId);
  if (!pending) return list;
  return arrange([
    ...without,
    {
      ...pending,
      id: real.id,
      createdAt: real.createdAt,
      status: "sent",
    },
  ]);
}

export function failPending(list: ChatMessage[], clientId: string) {
  return list.map((m) =>
    m.id === clientId && m.status === "sending"
      ? { ...m, status: "failed" as const }
      : m,
  );
}

export function retryPending(list: ChatMessage[], clientId: string) {
  return list.map((m) =>
    m.id === clientId && m.status === "failed"
      ? { ...m, status: "sending" as const }
      : m,
  );
}

export function removePending(list: ChatMessage[], clientId: string) {
  return list.filter((m) => !(m.id === clientId && m.status !== "sent"));
}

// Where to continue polling from: the newest message that is really saved.
export function newestSentAt(list: ChatMessage[]): string | null {
  let newest: string | null = null;
  for (const m of list) {
    if (m.status === "sent" && (newest === null || m.createdAt > newest)) {
      newest = m.createdAt;
    }
  }
  return newest;
}
