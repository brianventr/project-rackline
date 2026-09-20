import { formatAsBuiltPart, type AsBuiltView } from "@/domain/as-built";
import type { AsBuiltLink } from "../api";
import { Card } from "./ui";

export function AsBuiltList({
  title,
  empty,
  rows,
  mode,
}: {
  title: string;
  empty: string;
  rows: AsBuiltLink[] | AsBuiltView[];
  mode: "from" | "into";
}) {
  return (
    <Card>
      <p className="mb-3 font-medium">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((row, index) => (
            <li key={`${row.refId}:${row.parentSerial}:${row.componentItemId}:${row.componentLotCode}:${row.componentSerial}:${index}`} className="font-mono">
              {mode === "from"
                ? formatAsBuiltPart({
                    sku: row.componentSku,
                    lotCode: row.componentLotCode,
                    serial: row.componentSerial,
                    qty: row.qty,
                  })
                : formatAsBuiltPart({
                    sku: row.parentSku,
                    lotCode: row.parentLotCode,
                    serial: row.parentSerial,
                    qty: row.qty,
                  })}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
