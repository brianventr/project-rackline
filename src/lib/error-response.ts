import { HttpError } from "./http";
import { InsufficientStockError } from "../domain/inventory";
import { OverReceiveError, OverUnreceiveError } from "../domain/partial-receive";
import { OverPickError } from "../domain/partial-pick";
import { OverPackError } from "../domain/partial-pack";
import { OverCartonError } from "../domain/cartons";
import { OverMoveError } from "../domain/partial-transfer";
import { OverReturnError } from "../domain/partial-rtv";
import { OverCompleteError } from "../domain/partial-complete";
import { OverUnpickError } from "../domain/partial-unpick";
import { OverBatchPickError } from "../domain/waves";
import { HeldStockError } from "../domain/holds";
import { ExpiredLotError } from "../domain/expiry";
import { InsufficientAtpError } from "../domain/allocations";
import { ClientStockError } from "../domain/client-stock";
import { JobClaimedError, JobNotReadyError, JobVerbDeniedError } from "../domain/jobs";
import { EquipmentCustodyError } from "../domain/equipment";
import { CarrierLiveError } from "../domain/carrier-live";
import { CustomsRequiredError } from "../domain/customs";
import { AddressInvalidError } from "../domain/address-check";
import { ShopifyIngestError } from "../domain/shopify-ingest";
import { ImageUrlError } from "../domain/media";
import { BomStepError } from "../domain/bom-steps";
import { WorkflowPolicyError } from "../domain/workflow-policy";
import { CapacityInputError, LocationFullError } from "../domain/capacity";
import { PlateInputError, PlateOverLooseError, PlateShortError, PlateStateError } from "../domain/license-plates";
import { causeChain, constraintFailure, isDatabaseError } from "./db-errors";

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 500;
export type MappedError = { status: ErrorStatus; body: Record<string, unknown> };

/** Columns whose UNIQUE failure can name the field in plain words. Anything else just "already exists". */
const UNIQUE_FIELD_LABELS: Record<string, string> = {
  sku: "SKU",
  barcode: "barcode",
  code: "code",
  name: "name",
  number: "number",
  email: "email",
  serial_code: "serial",
  lot_code: "lot code",
  shop_domain: "store",
  tracking_number: "tracking number",
};

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** A short id to quote to support; the server log carries the full error under it. */
export function errorRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => REF_ALPHABET[byte % REF_ALPHABET.length]).join("");
}

function uniqueField(columns: string[]): string | null {
  const named = columns.filter((column) => column !== "id" && !column.endsWith("_id"));
  return named.length === 1 ? (UNIQUE_FIELD_LABELS[named[0]!] ?? null) : null;
}

/** A unique or foreign key failure from D1, in plain words. Never the D1 text, which carries SQL. */
export function mapConstraintError(err: unknown): MappedError | null {
  const failure = constraintFailure(err);
  if (!failure) return null;
  if (failure.kind === "unique") {
    const field = uniqueField(failure.columns);
    return {
      status: 409,
      body: field ? { error: `That ${field} is already taken.`, code: "CONFLICT", field } : { error: "That already exists.", code: "CONFLICT" },
    };
  }
  if (failure.verb === "delete") {
    return { status: 409, body: { error: "That is still in use, so it cannot be removed.", code: "IN_USE" } };
  }
  return { status: 400, body: { error: "Something this refers to no longer exists.", code: "BAD_REFERENCE" } };
}

export function internalError(ref: string): MappedError {
  return { status: 500, body: { error: "Something went wrong on our side.", code: "INTERNAL", ref } };
}

/**
 * The response for any thrown error. Typed errors keep their status and code; D1 constraint
 * failures read as CONFLICT, IN_USE, or BAD_REFERENCE; everything else is a 500 whose reference
 * is logged beside the full error. No body ever carries D1 or SQL text.
 */
export function respondToError(err: unknown, where: string, ref = errorRef()): MappedError {
  const mapped = mapDomainError(err);
  if (mapped && !isDatabaseError(err)) return mapped;
  const constraint = mapConstraintError(err);
  if (constraint) {
    console.warn(`${constraint.body.code} on ${where}`, ...causeChain(err));
    return constraint;
  }
  console.error(`Error ${ref} on ${where}`, ...causeChain(err));
  return internalError(ref);
}

export function mapDomainError(err: unknown): MappedError | null {
  if (err instanceof InsufficientStockError) {
    return {
      status: 409,
      body: { error: err.message, code: "INSUFFICIENT_STOCK", sku: err.sku, onHand: err.onHand, needed: err.needed },
    };
  }
  if (err instanceof OverReceiveError) {
    return {
      status: 409,
      body: { error: err.message, code: "OVER_RECEIVE", sku: err.sku, remaining: err.remaining, qty: err.qty },
    };
  }
  if (err instanceof OverUnreceiveError) {
    return {
      status: 409,
      body: { error: err.message, code: "OVER_UNRECEIVE", sku: err.sku, received: err.received, qty: err.qty },
    };
  }
  if (err instanceof OverPickError) {
    return {
      status: 409,
      body: { error: err.message, code: "OVER_PICK", sku: err.sku, remaining: err.remaining, qty: err.qty },
    };
  }
  if (err instanceof OverPackError) {
    return {
      status: 409,
      body: { error: err.message, code: "OVER_PACK", sku: err.sku, remaining: err.remaining, qty: err.qty },
    };
  }
  if (err instanceof OverCartonError) {
    return {
      status: 409,
      body: { error: err.message, code: "OVER_CARTON", sku: err.sku, remaining: err.remaining, qty: err.qty },
    };
  }
  if (err instanceof OverMoveError) {
    return {
      status: 409,
      body: { error: err.message, code: "OVER_MOVE", sku: err.sku, remaining: err.remaining, qty: err.qty },
    };
  }
  if (err instanceof OverReturnError) {
    return {
      status: 409,
      body: { error: err.message, code: "OVER_RETURN", sku: err.sku, remaining: err.remaining, qty: err.qty },
    };
  }
  if (err instanceof OverCompleteError) {
    return {
      status: 409,
      body: { error: err.message, code: "OVER_COMPLETE", sku: err.sku, remaining: err.remaining, qty: err.qty },
    };
  }
  if (err instanceof OverUnpickError) {
    return {
      status: 409,
      body: { error: err.message, code: "OVER_UNPICK", sku: err.sku, remaining: err.remaining, qty: err.qty },
    };
  }
  if (err instanceof OverBatchPickError) {
    return {
      status: 409,
      body: { error: err.message, code: "OVER_BATCH_PICK", sku: err.sku, remaining: err.remaining, qty: err.qty },
    };
  }
  if (err instanceof HeldStockError) {
    return {
      status: 409,
      body: {
        error: err.message,
        code: "HELD_STOCK",
        sku: err.sku,
        locationCode: err.locationCode,
        holdNumber: err.holdNumber,
        reason: err.reason,
      },
    };
  }
  if (err instanceof ExpiredLotError) {
    return {
      status: 400,
      body: {
        error: err.message,
        code: "EXPIRED_LOT",
        sku: err.sku,
        lotCode: err.lotCode ?? null,
        expiresOn: err.expiresOn ?? null,
      },
    };
  }
  if (err instanceof InsufficientAtpError) {
    return {
      status: 409,
      body: {
        error: err.message,
        code: "INSUFFICIENT_ATP",
        sku: err.sku,
        atp: err.atp,
        needed: err.needed,
        locationCode: err.locationCode,
        ...(err.clientId !== undefined ? { clientId: err.clientId } : {}),
      },
    };
  }
  if (err instanceof ClientStockError) {
    return {
      status: 409,
      body: {
        error: err.message,
        code: "CLIENT_STOCK",
        clientId: err.clientId,
        itemId: err.itemId,
        onHand: err.onHand,
        needed: err.needed,
      },
    };
  }
  if (err instanceof JobClaimedError) {
    return {
      status: 409,
      body: {
        error: err.message,
        code: "JOB_CLAIMED",
        claimedById: err.claimedById,
        claimedByName: err.claimedByName,
      },
    };
  }
  if (err instanceof EquipmentCustodyError) {
    return { status: 409, body: { error: err.message, code: err.code, ...err.extras } };
  }
  if (err instanceof CarrierLiveError) {
    return { status: 409, body: { error: err.message, code: err.code } };
  }
  if (err instanceof CustomsRequiredError) {
    return { status: 409, body: { error: err.message, code: err.code, sku: err.sku, items: err.gaps } };
  }
  if (err instanceof AddressInvalidError) {
    return { status: 409, body: { error: err.message, code: err.code, suggestion: err.suggestion } };
  }
  if (err instanceof JobNotReadyError) {
    return { status: 409, body: { error: err.message, code: "JOB_NOT_READY", notBefore: err.notBefore } };
  }
  if (err instanceof JobVerbDeniedError) {
    return { status: 403, body: { error: err.message, code: "JOB_VERB_DENIED", verb: err.verb } };
  }
  if (err instanceof ShopifyIngestError) {
    return { status: err.status as 400 | 409, body: { error: err.message } };
  }
  if (err instanceof WorkflowPolicyError) {
    return { status: 409, body: { error: err.message, code: err.code } };
  }
  if (err instanceof LocationFullError) {
    return {
      status: 409,
      body: {
        error: err.message,
        code: "LOCATION_FULL",
        locationCode: err.locationCode,
        measure: err.breach.measure,
        limit: err.breach.limit,
        before: err.breach.before,
        wouldBe: err.breach.after,
      },
    };
  }
  if (err instanceof PlateStateError) {
    return {
      status: 409,
      body: { error: err.message, code: "PLATE_STATUS", plateCode: err.plateCode, plateStatus: err.status, action: err.action },
    };
  }
  if (err instanceof PlateOverLooseError) {
    return {
      status: 409,
      body: {
        error: err.message,
        code: "PLATE_OVER_LOOSE",
        plateCode: err.plateCode,
        sku: err.sku,
        locationCode: err.locationCode,
        onHand: err.onHand,
        loose: err.loose,
        qty: err.qty,
        lotCode: err.lotCode,
        expired: err.expired,
      },
    };
  }
  if (err instanceof PlateShortError) {
    return {
      status: 409,
      body: {
        error: err.message,
        code: "PLATE_SHORT",
        plateCode: err.plateCode,
        sku: err.sku,
        onPlate: err.onPlate,
        needed: err.needed,
        serial: err.serial,
      },
    };
  }
  if (
    err instanceof ImageUrlError ||
    err instanceof BomStepError ||
    err instanceof CapacityInputError ||
    err instanceof PlateInputError
  ) {
    return { status: 400, body: { error: err.message } };
  }
  if (err instanceof HttpError) {
    return {
      status: err.status as ErrorStatus,
      body: err.code ? { error: err.message, code: err.code } : { error: err.message },
    };
  }
  return null;
}
