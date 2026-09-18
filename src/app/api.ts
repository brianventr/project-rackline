import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
});

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  if (res.status === 204) {
    return undefined as T;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : res.statusText) || "Request failed";
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

export type Me = {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string };
  role: "owner" | "operator";
  warehouses: { id: string; name: string }[];
};

export type Item = {
  id: string;
  sku: string;
  name: string;
  type: string;
};

export type Location = {
  id: string;
  code: string;
  name: string;
  type: string;
  warehouseId: string;
  warehouseName: string;
};

export type InventoryRow = {
  id: string;
  qty: number;
  sku: string;
  itemName: string;
  itemType: string;
  itemId: string;
  locationId: string;
  locationCode: string;
  locationName: string;
};

export type Receipt = {
  id: string;
  number: string;
  status: string;
  notes: string | null;
  createdAt: number;
  locationId: string | null;
  lines?: { id: string; itemId: string; qty: number; sku: string; itemName: string }[];
};

export type Order = {
  id: string;
  number: string;
  customerName: string;
  status: string;
  createdAt: number;
  pickLocationId: string | null;
  lines?: { id: string; itemId: string; qty: number; sku: string; itemName: string }[];
};

export type Bom = {
  id: string;
  itemId: string;
  sku: string;
  itemName: string;
  lines: { id: string; itemId: string; qty: number; sku: string; itemName: string }[];
};

export type WorkOrder = {
  id: string;
  number: string;
  itemId: string;
  qty: number;
  status: string;
  sku: string;
  itemName: string;
  sourceLocationId: string;
  outputLocationId: string;
  createdAt: number;
};

export type Dashboard = {
  onHandUnits: number;
  binRows: number;
  skuCount: number;
  openReceipts: number;
  openOrders: number;
  openWorkOrders: number;
  recent: { id: string; type: string; qty: number; createdAt: number; sku: string }[];
};
