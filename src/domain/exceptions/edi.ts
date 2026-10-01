import { clipInboxText } from "../edi-inbox";
import { asSentence } from "../error-copy";
import { DAY_MS, exceptionItem, MANUFACTURER_ONLY, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

/** Supplier ASNs Rackline refused. A later ASN from the same vendor with the same reference that got in clears one. */
export const EDI_SOURCE: ExceptionSourceInfo = { id: "edi", label: "EDI", modes: MANUFACTURER_ONLY };

export const EDI_WINDOW_MS = 30 * DAY_MS;

export type EdiFailureRow = {
  id: string;
  error: string | null;
  createdAt: number;
  /** As stored in the refused body: any JSON value at all. */
  vendorName: unknown;
  reference: unknown;
};

/** ASNs come in for the whole org, so every building lists them. */
export function ediProblems(rows: readonly EdiFailureRow[]): ExceptionItem[] {
  return rows.map((row) => {
    const vendor = clipInboxText(row.vendorName);
    const reference = clipInboxText(row.reference);
    const asn = reference ? `ASN ${reference}` : "An ASN";
    return exceptionItem({
      source: EDI_SOURCE.id,
      key: row.id,
      kind: "asn_refused",
      kindLabel: "ASN refused",
      severity: "warning",
      title: `${asn}${vendor ? ` from ${vendor}` : ""} was refused`,
      detail: `${row.error ? asSentence(row.error) : "Rackline could not read it."} Nothing is expected at the dock until it comes in. Fix the SKU or field it names and ask the supplier to send it again.`,
      createdAt: row.createdAt,
      link: "/setup/edi",
      ownerOnly: true,
    });
  });
}
