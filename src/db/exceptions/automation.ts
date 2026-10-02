import { automationProblems, AUTOMATION_SOURCE } from "../../domain/exceptions/automation";
import { SOURCE_LIMIT } from "../../domain/exceptions/inbox";
import { loadReorderQueue } from "../reorder";
import { loadAutomationPolicy, loadReplenishSnapshot } from "../replenish-automation";
import type { ExceptionSource } from "./source";

export const automationSource: ExceptionSource = {
  ...AUTOMATION_SOURCE,
  loadLimit: SOURCE_LIMIT + 1,
  async load({ db, organizationId, warehouseId, mode, now }) {
    const policy = await loadAutomationPolicy(db, organizationId);
    const watchStock = policy.bulkGap === "exception" || policy.remindOpenAfterHours != null;
    const watchReorder = policy.reorderAlert === "exception";
    if (!watchStock && !watchReorder) return [];

    const snapshot = watchStock ? await loadReplenishSnapshot(db, organizationId, warehouseId) : null;
    const reorder = watchReorder ? await loadReorderQueue(db, organizationId, warehouseId) : null;
    return automationProblems({
      policy,
      mode,
      now,
      warehouseId,
      starved: snapshot?.starved ?? [],
      openReplenishments: snapshot?.open ?? [],
      lowStock: reorder?.lowStock ?? [],
    }).slice(0, SOURCE_LIMIT + 1);
  },
};
