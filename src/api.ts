import { supabase } from "./supabase";

const apiUrl = import.meta.env.VITE_API_URL;

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as { data?: T; error?: string } | null;
  if (!response.ok) throw new ApiError(body?.error ?? `Request failed (${response.status})`);
  return body?.data as T;
}

export interface Overview {
  subscription_mode: boolean;
  stores: number;
  paying: number;
  scans_this_month: number;
  users: number;
  users_without_store: number;
  forced_on: number;
  forced_off: number;
}

export interface StoreRow {
  id: string;
  name: string;
  subscription_status: string;
  subscription_plan: string | null;
  grace_until: string | null;
  created_at: string;
  owner_name: string | null;
  owner_email: string | null;
  subscription_override: "on" | "off" | null;
  subscription_enforced: boolean;
  plan_scans_remaining: number;
  topup_scans_remaining: number;
  scans_remaining: number;
}

export interface StoreDetail extends StoreRow {
  has_stripe: boolean;
  members: { user_id: string; role: string; full_name: string; email: string }[];
  ledger: { id: string; delta: number; reason: string; note: string | null; created_at: string }[];
}

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  created_at: string | null;
  last_sign_in_at: string | null;
  store_id: string | null;
  store_name: string | null;
  role: string | null;
}

export type SubscriptionChoice = "on" | "off" | "platform";

export const adminApi = {
  overview: () => request<Overview>("/admin/overview"),
  stores: () => request<StoreRow[]>("/admin/stores"),
  store: (id: string) => request<StoreDetail>(`/admin/stores/${id}`),
  users: () => request<UserRow[]>("/admin/users"),
  setStoreSubscription: (id: string, override: SubscriptionChoice) =>
    request<{ subscription_override: "on" | "off" | null; grace_until: string | null; subscription_enforced: boolean }>(
      `/admin/stores/${id}/subscription`,
      { method: "PATCH", body: JSON.stringify({ override }) },
    ),
  adjustScans: (id: string, delta: number, note: string) =>
    request<{ scans_remaining: number }>(`/admin/stores/${id}/scans`, {
      method: "POST",
      body: JSON.stringify({ delta, note }),
    }),
  settings: () => request<{ subscription_mode: boolean; updated_at: string }>("/admin/settings"),
  setMode: (subscription_mode: boolean) =>
    request<{ subscription_mode: boolean }>("/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({ subscription_mode }),
    }),
};
