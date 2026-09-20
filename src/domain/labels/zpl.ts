export type LabelMedia = "letter" | "4x6" | "2x1";

export type LabelKind = "bay" | "item" | "shipping-label" | "sheet";

export type LabelPayload = {
  format: "zpl" | "html";
  body: string;
  filename: string;
};

function escapeZpl(value: string): string {
  return value.replace(/[\^~]/g, " ").slice(0, 64);
}

function labelSizeDots(media: LabelMedia, dpi: number): { width: number; height: number } {
  if (media === "2x1") return { width: Math.round(2 * dpi), height: Math.round(1 * dpi) };
  if (media === "4x6") return { width: Math.round(4 * dpi), height: Math.round(6 * dpi) };
  return { width: Math.round(8.5 * dpi), height: Math.round(11 * dpi) };
}

export function zplBayLabel(input: { code: string; name: string; barcode: string }, media: LabelMedia = "2x1", dpi = 203): string {
  const { width, height } = labelSizeDots(media === "letter" ? "2x1" : media, dpi);
  const code = escapeZpl(input.code);
  const name = escapeZpl(input.name);
  const barcode = escapeZpl(input.barcode || input.code);
  return [
    "^XA",
    `^PW${width}`,
    `^LL${height}`,
    "^LH0,0",
    `^FO40,30^A0N,40,40^FD${code}^FS`,
    `^FO40,80^A0N,28,28^FD${name}^FS`,
    `^FO40,130^BY2^BCN,80,Y,N,N^FD${barcode}^FS`,
    "^XZ",
  ].join("\n");
}

export function zplItemLabel(input: { sku: string; name: string; barcode: string }, media: LabelMedia = "2x1", dpi = 203): string {
  const { width, height } = labelSizeDots(media === "letter" ? "2x1" : media, dpi);
  const sku = escapeZpl(input.sku);
  const name = escapeZpl(input.name);
  const barcode = escapeZpl(input.barcode || input.sku);
  return [
    "^XA",
    `^PW${width}`,
    `^LL${height}`,
    "^LH0,0",
    `^FO40,30^A0N,40,40^FD${sku}^FS`,
    `^FO40,80^A0N,28,28^FD${name}^FS`,
    `^FO40,130^BY2^BCN,80,Y,N,N^FD${barcode}^FS`,
    "^XZ",
  ].join("\n");
}

export function zplShippingLabel(
  input: {
    orderNumber: string;
    customerName: string;
    shipToAddress: string;
    carrierCompany: string;
    carrierService: string;
    trackingNumber: string;
  },
  media: LabelMedia = "4x6",
  dpi = 203,
): string {
  const { width, height } = labelSizeDots(media === "letter" ? "4x6" : media, dpi);
  const orderNumber = escapeZpl(input.orderNumber);
  const customer = escapeZpl(input.customerName);
  const carrier = escapeZpl(`${input.carrierCompany} ${input.carrierService}`);
  const tracking = escapeZpl(input.trackingNumber);
  const addressLines = input.shipToAddress
    .split("\n")
    .map((line) => escapeZpl(line))
    .filter(Boolean)
    .slice(0, 4);
  const addressBlock = addressLines
    .map((line, index) => `^FO40,${140 + index * 36}^A0N,28,28^FD${line}^FS`)
    .join("\n");
  return [
    "^XA",
    `^PW${width}`,
    `^LL${height}`,
    "^LH0,0",
    `^FO40,40^A0N,36,36^FDShip to^FS`,
    `^FO40,90^A0N,44,44^FD${customer}^FS`,
    addressBlock,
    `^FO40,320^A0N,28,28^FD${orderNumber}^FS`,
    `^FO40,360^A0N,28,28^FD${carrier}^FS`,
    `^FO40,410^A0N,40,40^FD${tracking}^FS`,
    `^FO40,470^BY2^BCN,120,Y,N,N^FD${tracking}^FS`,
    "^XZ",
  ].join("\n");
}

export function buildLabelPayload(
  kind: LabelKind,
  data: Record<string, string>,
  media: LabelMedia = "4x6",
  dpi = 203,
): LabelPayload {
  if (kind === "bay") {
    const body = zplBayLabel(
      { code: data.code || "", name: data.name || "", barcode: data.barcode || data.code || "" },
      media,
      dpi,
    );
    return { format: "zpl", body, filename: `${data.code || "bay"}.zpl` };
  }
  if (kind === "item") {
    const body = zplItemLabel(
      { sku: data.sku || "", name: data.name || "", barcode: data.barcode || data.sku || "" },
      media,
      dpi,
    );
    return { format: "zpl", body, filename: `${data.sku || "item"}.zpl` };
  }
  if (kind === "shipping-label") {
    const body = zplShippingLabel(
      {
        orderNumber: data.orderNumber || "",
        customerName: data.customerName || "",
        shipToAddress: data.shipToAddress || "",
        carrierCompany: data.carrierCompany || "",
        carrierService: data.carrierService || "",
        trackingNumber: data.trackingNumber || "",
      },
      media,
      dpi,
    );
    return { format: "zpl", body, filename: `${data.orderNumber || "shipping"}.zpl` };
  }
  const parts = (data.labelsJson ? (JSON.parse(data.labelsJson) as Array<{ kind: "bay" | "item"; code?: string; sku?: string; name: string; barcode: string }>) : []).map(
    (row) =>
      row.kind === "bay"
        ? zplBayLabel({ code: row.code || row.barcode, name: row.name, barcode: row.barcode }, "2x1", dpi)
        : zplItemLabel({ sku: row.sku || row.barcode, name: row.name, barcode: row.barcode }, "2x1", dpi),
  );
  return { format: "zpl", body: parts.join("\n"), filename: "labels.zpl" };
}
