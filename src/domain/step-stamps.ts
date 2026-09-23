export type StepStamp = { at: number; by: string | null };

/** Which ledger movements mark a step, and whether the first or last one stamps it. */
export type StepRule = { types: readonly string[]; pick: "first" | "last" };

export type StampSource = { type: string; createdAt: number; createdByName?: string | null };

/**
 * When and by whom each reached step happened, read from the document's ledger lines.
 * Steps after the current status stay blank even if a movement exists (e.g. after an unpick).
 */
export function stepStamps(
  steps: readonly string[],
  current: string,
  movements: readonly StampSource[],
  rules: Partial<Record<string, StepRule>>,
): Record<string, StepStamp> {
  const reached = steps.indexOf(current);
  const stamps: Record<string, StepStamp> = {};
  if (reached < 0) return stamps;
  steps.forEach((step, index) => {
    if (index > reached) return;
    const rule = rules[step];
    if (!rule) return;
    let chosen: StampSource | null = null;
    for (const movement of movements) {
      if (!rule.types.includes(movement.type)) continue;
      if (
        !chosen ||
        (rule.pick === "first" ? movement.createdAt < chosen.createdAt : movement.createdAt > chosen.createdAt)
      ) {
        chosen = movement;
      }
    }
    if (chosen) stamps[step] = { at: chosen.createdAt, by: chosen.createdByName ?? null };
  });
  return stamps;
}

const RECEIVE_RULES = {
  receiving: { types: ["receive"], pick: "first" },
  received: { types: ["receive"], pick: "last" },
} as const satisfies Record<string, StepRule>;

export const STEP_RULES = {
  order: {
    picking: { types: ["pick"], pick: "first" },
    picked: { types: ["pick"], pick: "last" },
    shipped: { types: ["ship"], pick: "last" },
  },
  receipt: RECEIVE_RULES,
  purchase: RECEIVE_RULES,
  asn: RECEIVE_RULES,
  rma: RECEIVE_RULES,
  transfer: {
    in_progress: { types: ["move"], pick: "first" },
    posted: { types: ["move"], pick: "last" },
  },
  replenishment: {
    in_progress: { types: ["move"], pick: "first" },
    posted: { types: ["move"], pick: "last" },
  },
  workOrder: {
    in_progress: { types: ["wo_produce"], pick: "first" },
    completed: { types: ["wo_produce"], pick: "last" },
  },
  kit: {
    in_progress: { types: ["kit_produce"], pick: "first" },
    completed: { types: ["kit_produce"], pick: "last" },
  },
  vendorReturn: {
    returning: { types: ["rtv"], pick: "first" },
    returned: { types: ["rtv"], pick: "last" },
  },
} as const satisfies Record<string, Partial<Record<string, StepRule>>>;
