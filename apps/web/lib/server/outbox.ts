import { listDueDrafts, saveDraft } from "./db";
import { sendComposedMessage } from "./mail-actions";

export async function processOutboundQueue() {
  const results: Array<{ id: string; state: "sent" | "failed"; error?: string }> = [];
  for (const draft of listDueDrafts()) {
    const {
      id, userId, state: _state, error: _error,
      createdAt: _createdAt, updatedAt: _updatedAt, ...payload
    } = draft;
    // Mark first so a concurrent worker or crash can never double-send. A
    // post-send crash leaves an inspectable "sending" record for recovery.
    saveDraft(userId, payload, { id, state: "sending" });
    try {
      await sendComposedMessage(payload);
      saveDraft(userId, payload, { id, state: "sent" });
      results.push({ id, state: "sent" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delivery failed.";
      saveDraft(userId, payload, { id, state: "failed", error: message });
      results.push({ id, state: "failed", error: message });
    }
  }
  return results;
}
