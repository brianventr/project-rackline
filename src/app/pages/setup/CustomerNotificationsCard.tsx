import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorText } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, Select } from "../../components/ui";
import { useApiQuery } from "../../query";
import { useWrite } from "../../use-write";

type Policy = "store" | "always" | "never";

type NotificationSettings = {
  shipped: Policy;
  outForDelivery: Policy;
  delivered: Policy;
  deliveryException: Policy;
  returnLabel: Policy;
  replyTo: string | null;
  senderName: string | null;
  mailConfigured: boolean;
};

type Preview = { subject: string; html: string; text: string };

const EVENTS: { key: keyof Pick<NotificationSettings, "shipped" | "outForDelivery" | "delivered" | "deliveryException" | "returnLabel">; label: string }[] = [
  { key: "shipped", label: "Shipped" },
  { key: "outForDelivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
  { key: "deliveryException", label: "Delivery exception" },
  { key: "returnLabel", label: "Return label ready" },
];

const POLICIES: { value: Policy; label: string }[] = [
  { value: "store", label: "Only when the store doesn't notify" },
  { value: "always", label: "Always" },
  { value: "never", label: "Never" },
];

/** Per-org customer email policy, next to the tracking page branding. */
export function CustomerNotificationsCard({ disabled }: { disabled: boolean }) {
  const settings = useApiQuery<NotificationSettings>(disabled ? null : "/api/organization/notifications");
  const write = useWrite();
  const [form, setForm] = useState<NotificationSettings | null>(null);
  const [previewEvent, setPreviewEvent] = useState<(typeof EVENTS)[number]["key"]>("shipped");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  function setPolicy(key: (typeof EVENTS)[number]["key"], value: Policy) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save() {
    if (!form) return;
    await write.run(
      "Save customer emails",
      () =>
        api("/api/organization/notifications", {
          method: "PATCH",
          body: JSON.stringify({
            shipped: form.shipped,
            outForDelivery: form.outForDelivery,
            delivered: form.delivered,
            deliveryException: form.deliveryException,
            returnLabel: form.returnLabel,
            replyTo: form.replyTo ?? "",
            senderName: form.senderName ?? "",
          }),
        }),
      "Customer emails saved.",
    );
  }

  async function loadPreview() {
    setPreviewError(null);
    try {
      const next = await api<Preview>("/api/organization/notifications/preview", {
        method: "POST",
        body: JSON.stringify({ event: previewEvent }),
      });
      setPreview(next);
    } catch (err) {
      setPreviewError(errorText(err, "Could not preview that email."));
    }
  }

  async function sendTest() {
    await write.run(
      "Send test email",
      () =>
        api<{ logged?: boolean }>("/api/organization/notifications/test", {
          method: "POST",
          body: JSON.stringify({ event: previewEvent }),
        }),
      form?.mailConfigured ? "Test sent to you." : "Mail is not configured, so the test was logged.",
    );
  }

  return (
    <Card>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Customer emails</h2>
          <p className="text-sm text-muted-foreground">
            Shipped, out for delivery, delivered, a delivery problem, and a return label. The default sends only when the
            store does not already notify the customer. Live Shopify, WooCommerce, and Etsy post-backs count as the store
            notifying. Manual, CSV, Faire, and a manual post-back do not.{" "}
            <Link to="/automation?step=reminders" className="font-medium text-primary underline-offset-4 hover:underline">
              Open the automation map
            </Link>
            .
          </p>
        </div>
        <ErrorBanner error={write.error ?? settings.error?.message ?? previewError} />
        {form && !form.mailConfigured ? (
          <p className="text-sm text-tone-warning">
            MAIL_API_KEY is not set, so these messages are logged on the server instead of sent. From stays MAIL_FROM once
            mail is configured.
          </p>
        ) : null}
        {form
          ? EVENTS.map((event) => (
              <Field key={event.key} label={event.label}>
                <Select
                  value={form[event.key]}
                  disabled={disabled}
                  onChange={(change) => setPolicy(event.key, change.target.value as Policy)}
                >
                  {POLICIES.map((policy) => (
                    <option key={policy.value} value={policy.value}>
                      {policy.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ))
          : null}
        {form ? (
          <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
            <Field label="Sender name">
              <Input
                value={form.senderName ?? ""}
                disabled={disabled}
                placeholder="Northwind Makers"
                onChange={(event) => setForm({ ...form, senderName: event.target.value })}
              />
            </Field>
            <Field label="Reply-to">
              <Input
                value={form.replyTo ?? ""}
                disabled={disabled}
                placeholder="hello@northwind.example"
                onChange={(event) => setForm({ ...form, replyTo: event.target.value })}
              />
            </Field>
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" variant="outline" disabled={disabled || write.busy || !form}>
            Save customer emails
          </Button>
        </div>
        <div className="space-y-2 border-t pt-3">
          <Field label="Preview">
            <Select value={previewEvent} disabled={disabled} onChange={(event) => setPreviewEvent(event.target.value as (typeof EVENTS)[number]["key"])}>
              {EVENTS.map((event) => (
                <option key={event.key} value={event.key}>
                  {event.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={disabled} onClick={() => void loadPreview()}>
              Preview
            </Button>
            <Button type="button" variant="outline" disabled={disabled || write.busy} onClick={() => void sendTest()}>
              Send a test to me
            </Button>
          </div>
          {preview ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{preview.subject}</p>
              <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-72 w-full rounded-md border bg-white" />
            </div>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
