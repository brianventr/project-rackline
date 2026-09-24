import { api } from "@/app/api";
import { binKindLabel, slotRoleLabel } from "@/domain/hierarchy";
import type { ExistingBin, SetupRequest } from "@/domain/setup-wizard";

export type CreateProgress = { index: number; total: number; label: string };

/** A line the progress bar can show: "Creating rack A-01". */
export function requestLabel(request: SetupRequest): string {
  switch (request.kind) {
    case "warehouse":
      return "Saving the building";
    case "area":
      return `Adding ${binKindLabel(request.body.type).toLowerCase()} ${request.body.code}`;
    case "rack":
      return `Creating rack ${request.body.aisle}-${request.body.rack}`;
    case "slotRole":
      return `Marking ${request.code} as ${(slotRoleLabel(request.slotRole) ?? request.slotRole).toLowerCase()}`;
  }
}

/** What a request leaves behind, for the "already created" list after a failure. */
export function createdLabel(request: SetupRequest): string | null {
  switch (request.kind) {
    case "area":
      return request.body.code;
    case "rack":
      return `${request.body.aisle}-${request.body.rack} (${request.codes.length} ${request.codes.length === 1 ? "bin" : "bins"})`;
    default:
      return null;
  }
}

/**
 * Run the plan's requests in order. Throws on the first failure; `onProgress` and `created` tell the
 * caller how far it got so the page can say what already exists.
 */
export async function runSetupRequests(input: {
  warehouseId: string;
  requests: SetupRequest[];
  existing: ExistingBin[];
  /** Labels of what got made, for the "already created" line. */
  created: string[];
  /** Every request that finished, so a retry knows what is still owed. */
  completed: SetupRequest[];
  onProgress: (progress: CreateProgress) => void;
}): Promise<void> {
  const { warehouseId, requests, existing, created, completed, onProgress } = input;
  const idByCode = new Map(existing.map((bin) => [bin.code.toUpperCase(), bin.id]));
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index]!;
    onProgress({ index: index + 1, total: requests.length, label: requestLabel(request) });
    if (request.kind === "warehouse") {
      await api(`/api/warehouses/${encodeURIComponent(warehouseId)}`, {
        method: "PATCH",
        body: JSON.stringify(request.body),
      });
    } else if (request.kind === "area") {
      const result = await api<{ location: { id: string; code: string } }>("/api/layout/areas", {
        method: "POST",
        body: JSON.stringify({ warehouseId, ...request.body }),
      });
      idByCode.set(result.location.code.toUpperCase(), result.location.id);
      created.push(createdLabel(request) ?? request.body.code);
    } else if (request.kind === "rack") {
      const result = await api<{ locations: { id: string; code: string }[] }>("/api/layout/racks", {
        method: "POST",
        body: JSON.stringify({ warehouseId, ...request.body }),
      });
      for (const location of result.locations) idByCode.set(location.code.toUpperCase(), location.id);
      created.push(createdLabel(request) ?? `${request.body.aisle}-${request.body.rack}`);
    } else {
      const id = idByCode.get(request.code.toUpperCase());
      if (!id) throw new Error(`${request.code} was not created, so its slot role could not be set.`);
      await api(`/api/locations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ slotRole: request.slotRole }),
      });
    }
    completed.push(request);
  }
}
