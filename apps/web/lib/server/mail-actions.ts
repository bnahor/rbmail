import { getAccount, getThread, markThreadRead, setThreadArchived } from "./db";
import { changeGoogleMessage, replyWithGoogle, sendWithGoogle } from "./google";
import {
  changeMicrosoftMessage,
  replyWithMicrosoft,
  sendWithMicrosoft,
} from "./microsoft";

function context(threadId: string) {
  const thread = getThread(threadId);
  if (!thread) throw new Error("Thread not found.");
  const account = getAccount(thread.accountId);
  if (!account) throw new Error("Account not found.");
  const latest = thread.messages.at(-1);
  if (!latest) throw new Error("This conversation has no messages.");
  return { thread, account, latest };
}

export async function changeThread(
  threadId: string,
  action: "read" | "unread" | "archive",
) {
  const { thread, account, latest } = context(threadId);
  if (account.provider === "google") {
    await changeGoogleMessage(account, latest.providerId, action);
  } else {
    await changeMicrosoftMessage(account, latest.providerId, action);
  }
  if (action === "archive") setThreadArchived(thread.id, true);
  else markThreadRead(thread.id, action === "read");
}

export async function replyToThread(threadId: string, body: string) {
  const { thread, account, latest } = context(threadId);
  if (account.provider === "google") {
    await replyWithGoogle(account, {
      providerThreadId: thread.providerThreadId,
      to: latest.from.address,
      subject: thread.subject,
      body,
    });
  } else {
    await replyWithMicrosoft(account, latest.providerId, body);
  }
}

export async function sendMessage(
  accountId: string,
  input: { to: string; subject: string; body: string },
) {
  const account = getAccount(accountId);
  if (!account) throw new Error("Account not found.");
  if (account.provider === "google") {
    await sendWithGoogle(account, input);
  } else {
    await sendWithMicrosoft(account, input);
  }
}
