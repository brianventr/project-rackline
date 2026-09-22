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
import { ShopifyIngestError } from "../domain/shopify-ingest";
import { ImageUrlError } from "../domain/media";
import { BomStepError } from "../domain/bom-steps";

export type ErrorStatus = 400 | 401 | 403 | 404 | 409;
export type MappedError = { status: ErrorStatus; body: Record<string, unknown> };

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
  if (err instanceof JobNotReadyError) {
    return { status: 409, body: { error: err.message, code: "JOB_NOT_READY", notBefore: err.notBefore } };
  }
  if (err instanceof JobVerbDeniedError) {
    return { status: 403, body: { error: err.message, code: "JOB_VERB_DENIED", verb: err.verb } };
  }
  if (err instanceof ShopifyIngestError) {
    return { status: err.status as 400 | 409, body: { error: err.message } };
  }
  if (err instanceof ImageUrlError || err instanceof BomStepError) {
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
