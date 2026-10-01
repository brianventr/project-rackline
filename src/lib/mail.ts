import { purchaseMailRequest } from "../domain/purchase-mail";

export async function sendMail(input: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<{ id: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(purchaseMailRequest(input)),
  });
  const payload = (await res.json().catch(() => ({}))) as { id?: unknown; message?: unknown };
  if (!res.ok) {
    const message = typeof payload.message === "string" ? payload.message : `Mail HTTP ${res.status}`;
    throw new Error(message);
  }
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) throw new Error("Mail provider did not return an id");
  return { id };
}

export const sendPurchaseEmail = sendMail;

/** Customer shipment mail. `from` is already `Name <MAIL_FROM>` when a display name is set. */
export async function sendCustomerMail(input: {
  apiKey: string;
  from: string;
  replyTo?: string | null;
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ id: string }> {
  const body: Record<string, string> = {
    from: input.from.trim(),
    to: input.to.trim(),
    subject: input.subject.trim(),
    text: input.text,
    html: input.html,
  };
  if (input.replyTo?.trim()) body.reply_to = input.replyTo.trim();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { id?: unknown; message?: unknown };
  if (!res.ok) {
    const message = typeof payload.message === "string" ? payload.message : `Mail HTTP ${res.status}`;
    throw new Error(message);
  }
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) throw new Error("Mail provider did not return an id");
  return { id };
}