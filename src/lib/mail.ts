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