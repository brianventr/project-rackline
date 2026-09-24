import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "./session";
import { homePath } from "@/domain/home-path";

const STORAGE_KEY = "rackline.warehouseId";

type WarehouseState = {
  warehouseId: string;
  warehouse: { id: string; name: string } | undefined;
  warehouses: { id: string; name: string }[];
  setWarehouseId: (id: string) => void;
};

const WarehouseContext = createContext<WarehouseState | null>(null);

export function WarehouseProvider({ children }: { children: ReactNode }) {
  const me = useSession();
  const [warehouseId, setWarehouseIdState] = useState(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored && me.warehouses.some((row) => row.id === stored)) return stored;
    return me.warehouses[0]?.id ?? "";
  });

  const value = useMemo<WarehouseState>(() => {
    const warehouse = me.warehouses.find((row) => row.id === warehouseId) ?? me.warehouses[0];
    return {
      warehouseId: warehouse?.id ?? "",
      warehouse,
      warehouses: me.warehouses,
      setWarehouseId: (id: string) => {
        window.localStorage.setItem(STORAGE_KEY, id);
        setWarehouseIdState(id);
      },
    };
  }, [me.warehouses, warehouseId]);

  return <WarehouseContext.Provider value={value}>{children}</WarehouseContext.Provider>;
}

export function useWarehouse(): WarehouseState {
  const ctx = useContext(WarehouseContext);
  if (!ctx) throw new Error("useWarehouse must be used within WarehouseProvider");
  return ctx;
}

export { homePath };

export function inWarehouse<T extends { warehouseId?: string }>(rows: T[], warehouseId: string): T[] {
  if (!warehouseId) return rows;
  return rows.filter((row) => !row.warehouseId || row.warehouseId === warehouseId);
}

export function OwnerOnly({ children }: { children: ReactNode }) {
  const me = useSession();
  if (me.role !== "owner") return <Navigate to={homePath(me.role)} replace />;
  return children;
}
