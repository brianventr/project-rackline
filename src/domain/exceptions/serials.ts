import { BOTH_MODES, exceptionItem, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";
import type { ReconciliationProblem } from "../warranty";

export const SERIAL_SOURCE: ExceptionSourceInfo = { id: "serial", label: "Serials", modes: BOTH_MODES };

export function serialProblems(problems: ReconciliationProblem[]): ExceptionItem[] {
  return problems.map((problem) => {
    if (problem.kind === "missing_serial") {
      return exceptionItem({
        source: SERIAL_SOURCE.id,
        key: `missing:${problem.lineId}`,
        kind: "missing_serial",
        kindLabel: "Missing serial",
        severity: "warning",
        title: `${problem.orderNumber} shipped ${problem.sku} without a serial`,
        detail: `${problem.assigned} of ${problem.qty} serials are on file. Scan the rest on the serial fallback import.`,
        warehouseId: problem.warehouseId,
        orderId: problem.orderId,
        createdAt: null,
        link: "/setup/imports",
        lane: "office",
        ownerOnly: false,
      });
    }
    if (problem.kind === "duplicate_serial") {
      return exceptionItem({
        source: SERIAL_SOURCE.id,
        key: `duplicate:${problem.serial}`,
        kind: "duplicate_serial",
        kindLabel: "Duplicate serial",
        severity: "blocking",
        title: `Serial ${problem.serial} is on more than one order`,
        detail: "A serial can belong to one shipment. Look it up and clear the extra assignment.",
        warehouseId: problem.warehouseId,
        createdAt: null,
        link: "/floor/lookup",
        lane: "office",
        ownerOnly: false,
      });
    }
    return exceptionItem({
      source: SERIAL_SOURCE.id,
      key: `orphan:${problem.serial}`,
      kind: "orphan_serial",
      kindLabel: "Orphan serial",
      severity: "warning",
      title: `Serial ${problem.serial} shipped with no order`,
      detail: "This serial is marked shipped and is not assigned to an order.",
      warehouseId: problem.warehouseId,
      createdAt: null,
      link: "/floor/lookup",
      lane: "office",
      ownerOnly: false,
    });
  });
}
