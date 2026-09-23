import { QueryClient, useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

/** Every API read shares one key shape so a write can refresh whatever is on screen. */
export function apiKey(path: string) {
  return ["api", path] as const;
}

export function useApiQuery<T>(
  path: string | null | undefined,
  options?: Omit<UseQueryOptions<T, Error, T, readonly ["api", string]>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery({
    queryKey: apiKey(path ?? ""),
    queryFn: () => api<T>(path!),
    enabled: !!path,
    ...options,
  });
}

/** Refetch mounted API reads. Pass a prefix such as `/api/orders` to narrow it; the dashboard always refreshes. */
export function refreshApi(prefix?: string) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const [scope, path] = query.queryKey as [string, string?];
      if (scope !== "api") return false;
      if (!prefix) return true;
      return typeof path === "string" && (path.startsWith(prefix) || path.startsWith("/api/dashboard"));
    },
  });
}

/** POST/PATCH/DELETE through `api`, then refresh what is on screen. */
export async function apiMutate<T>(path: string, init: RequestInit & { refresh?: string } = {}): Promise<T> {
  const { refresh, ...rest } = init;
  const result = await api<T>(path, { method: "POST", ...rest });
  void refreshApi(refresh);
  return result;
}
