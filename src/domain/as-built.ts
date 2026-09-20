export const PRODUCE_TYPES = ["wo_produce", "kit_produce"] as const;
export const CONSUME_TYPES = ["wo_consume", "kit_consume"] as const;

export type AsBuiltMovement = {
  type: string;
  itemId: string;
  qty: number;
  lotCode?: string | null;
  serials?: string[] | null;
  refType: string;
  refId: string;
};

export type AsBuiltRow = {
  refType: string;
  refId: string;
  parentItemId: string;
  parentLotCode: string | null;
  parentSerial: string | null;
  componentItemId: string;
  componentLotCode: string | null;
  componentSerial: string | null;
  qty: number;
};

export type AsBuiltView = AsBuiltRow & {
  parentSku: string;
  componentSku: string;
};

type Piece = {
  itemId: string;
  lotCode: string | null;
  serial: string | null;
};

export function isProduceType(type: string): boolean {
  return (PRODUCE_TYPES as readonly string[]).includes(type);
}

export function isConsumeType(type: string): boolean {
  return (CONSUME_TYPES as readonly string[]).includes(type);
}

export function formatAsBuiltPart(row: {
  sku: string;
  lotCode?: string | null;
  serial?: string | null;
  qty?: number;
}): string {
  const parts = [row.sku, row.lotCode, row.serial].filter((value): value is string => Boolean(value));
  const label = parts.join(" ");
  return row.qty != null ? `${label} × ${row.qty}` : label;
}

export function buildAsBuilt(movements: AsBuiltMovement[]): AsBuiltRow[] {
  const produces = movements.filter((row) => isProduceType(row.type));
  const consumes = movements.filter((row) => isConsumeType(row.type));
  if (produces.length === 0 || consumes.length === 0) return [];

  const refs = [...new Set(produces.map((row) => row.refId))];
  const rows: AsBuiltRow[] = [];
  for (const refId of refs) {
    rows.push(
      ...assignRef(
        produces.filter((row) => row.refId === refId),
        consumes.filter((row) => row.refId === refId),
      ),
    );
  }
  return rows;
}

function assignRef(produces: AsBuiltMovement[], consumes: AsBuiltMovement[]): AsBuiltRow[] {
  const parents = explodePieces(produces);
  if (parents.length === 0 || consumes.length === 0) return [];
  const refType = produces[0]!.refType;
  const refId = produces[0]!.refId;

  const queues = new Map<string, Piece[]>();
  const originalCount = new Map<string, number>();
  for (const movement of consumes) {
    const pieces = explodePieces([movement]);
    const queue = queues.get(movement.itemId) ?? [];
    queue.push(...pieces);
    queues.set(movement.itemId, queue);
    originalCount.set(movement.itemId, (originalCount.get(movement.itemId) ?? 0) + pieces.length);
  }

  const parentCount = parents.length;
  const rows: AsBuiltRow[] = [];
  parents.forEach((parent, index) => {
    for (const [itemId, pieces] of queues) {
      const total = originalCount.get(itemId) ?? 0;
      const base = Math.floor(total / parentCount);
      const extra = total % parentCount;
      const take = base + (index < extra ? 1 : 0);
      const grabbed = pieces.splice(0, take);
      for (const group of collapse(grabbed)) {
        rows.push({
          refType,
          refId,
          parentItemId: parent.itemId,
          parentLotCode: parent.lotCode,
          parentSerial: parent.serial,
          componentItemId: itemId,
          componentLotCode: group.lotCode,
          componentSerial: group.serial,
          qty: group.qty,
        });
      }
    }
  });
  return rows;
}

function explodePieces(movements: AsBuiltMovement[]): Piece[] {
  const pieces: Piece[] = [];
  for (const movement of movements) {
    const lotCode = movement.lotCode?.trim() ? movement.lotCode.trim().toUpperCase() : null;
    const serials = (movement.serials ?? []).map((value) => value.trim().toUpperCase()).filter(Boolean);
    if (serials.length) {
      for (const serial of serials) {
        pieces.push({ itemId: movement.itemId, lotCode, serial });
      }
      continue;
    }
    const qty = Math.max(0, movement.qty);
    for (let index = 0; index < qty; index += 1) {
      pieces.push({ itemId: movement.itemId, lotCode, serial: null });
    }
  }
  return pieces;
}

function collapse(pieces: Piece[]): { lotCode: string | null; serial: string | null; qty: number }[] {
  const groups: { lotCode: string | null; serial: string | null; qty: number }[] = [];
  for (const piece of pieces) {
    const last = groups[groups.length - 1];
    if (last && last.lotCode === piece.lotCode && last.serial === piece.serial) {
      last.qty += 1;
    } else {
      groups.push({ lotCode: piece.lotCode, serial: piece.serial, qty: 1 });
    }
  }
  return groups;
}
