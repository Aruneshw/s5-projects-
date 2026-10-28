// src/lib/hooks.ts — small TanStack Query helpers used by the screens.
"use client";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api, issuesOf } from "./api";

export function useApi<T>(key: QueryKey, path: string | null, opts: { staleTime?: number } = {}) {
  return useQuery({ queryKey: key, queryFn: () => api<T>(path!), enabled: !!path, staleTime: opts.staleTime });
}

/** POST/PUT/PATCH helper that refreshes all queries afterwards and exposes friendly errors. */
export function useAction<TBody, TResult = unknown>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string | ((b: TBody) => string)) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (body: TBody) => api<TResult>(typeof path === "function" ? path(body) : path, { method, json: method === "DELETE" ? undefined : body }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const errorText = m.error ? [m.error.message, ...issuesOf(m.error)].join(" · ") : null;
  return { ...m, errorText };
}

export function idemKey(): string {
  return crypto.randomUUID();
}
