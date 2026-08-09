import type { ComposeMessageInput, MailAction } from "@/lib/mail/types";
import { getAccount, getThread, setThreadState } from "./db";
import {
  changeGoogleThread,
  replyWithGoogle,
  sendRichWithGoogle,
  sendWithGoogle,
  trashGoogleThread,
} from "./google";
import {
  changeMicrosoftMessages,
  replyWithMicrosoft,
  sendRichWithMicrosoft,
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
  action: MailAction,
  options: { snoozedUntil?: string | null } = {},
) {
  const { thread, account } = context(threadId);
  const providerAction = [
    "read", "unread", "flag", "unflag", "archive", "trash", "restore",
    "junk", "not_junk",
  ].includes(action);
  if (providerAction && account.provider === "google") {
    if (action === "trash" || action === "restore") {
      await trashGoogleThread(account, thread.providerThreadId, action === "restore");
    } else {
      await changeGoogleThread(
        account,
        thread.providerThreadId,
        action as "read" | "unread" | "flag" | "unflag" | "archive" | "junk" | "not_junk",
      );
    }
  } else if (providerAction) {
    await changeMicrosoftMessages(
      account,
      thread.messages.map((message) => message.providerId),
      action as "read" | "unread" | "flag" | "unflag" | "archive" | "trash" | "restore" | "junk" | "not_junk",
    );
  }
  setThreadState(thread.id, action, options);
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

export async function sendComposedMessage(input: ComposeMessageInput) {
  const account = getAccount(input.accountId);
  if (!account) throw new Error("Account not found.");
  if (!input.recipients.to.length && !input.recipients.cc.length && !input.recipients.bcc.length) {
    throw new Error("Add at least one recipient.");
  }
  if (account.provider === "google") {
    await sendRichWithGoogle(account, input);
  } else {
    await sendRichWithMicrosoft(account, input);
  }
}
