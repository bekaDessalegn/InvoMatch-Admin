import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";

import {
  adminApi,
  ApiError,
  type Overview,
  type StoreDetail,
  type StoreRow,
  type SubscriptionChoice,
  type UserRow,
} from "./api";
import { supabase } from "./supabase";

type Page = "home" | "stores" | "users" | "payments" | "settings";

const NAV: { id: Page; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "stores", label: "Stores" },
  { id: "users", label: "Users" },
  { id: "payments", label: "Payments" },
  { id: "settings", label: "Settings" },
];

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="boot">Loading…</div>;
  if (!session) return <Login />;
  return <Shell email={session.user.email ?? ""} />;
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (authError) setError(authError.message);
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="mark">IM</div>
        <h1>InvoMatch Admin</h1>
        <p className="sub">Sign in with a platform admin email.</p>
        <label>
          Email
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

function Shell({ email }: { email: string }) {
  const [page, setPage] = useState<Page>("home");
  const [storeId, setStoreId] = useState<string | null>(null);

  function openStore(id: string) {
    setPage("stores");
    setStoreId(id);
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="mark small">IM</span>
          InvoMatch
        </div>
        <nav>
          {NAV.map((item) => (
            <button key={item.id} className={page === item.id ? "nav active" : "nav"} onClick={() => setPage(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who" title={email}>{email}</div>
          <button className="nav" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        {page === "home" && <Home onOpenStore={openStore} />}
        {page === "stores" && <Stores selected={storeId} onSelect={setStoreId} />}
        {page === "users" && <Users onOpenStore={openStore} />}
        {page === "payments" && <Payments />}
        {page === "settings" && <Settings />}
      </main>
    </div>
  );
}

function Home({ onOpenStore }: { onOpenStore: (id: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([adminApi.overview(), adminApi.stores()])
      .then(([overview, rows]) => {
        setData(overview);
        setStores(rows);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load."));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="sub">Loading…</p>;

  const recent = stores.slice(0, 5);

  return (
    <>
      <PageHeader
        title="Home"
        subtitle={
          data.subscription_mode
            ? "Platform subscription is on. A store can still be turned off on its own."
            : "Platform subscription is off. Turn it on for one store from the store page."
        }
      />
      <div className="grid">
        <Stat label="Stores" value={data.stores} />
        <Stat label="Users" value={data.users} hint={data.users_without_store ? `${data.users_without_store} without a store` : "Everyone has a store"} />
        <Stat label="Paying" value={data.paying} />
        <Stat label="Scans this month" value={data.scans_this_month} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Newest stores</h2>
          <span className="hint">{data.forced_on} forced on · {data.forced_off} forced off</span>
        </div>
        {recent.length === 0 ? <p className="sub">No stores yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Owner</th>
                  <th>Subscription</th>
                  <th>Plan</th>
                  <th>Scans</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id} className="row" onClick={() => onOpenStore(row.id)}>
                    <td>{row.name}</td>
                    <td>{row.owner_name || row.owner_email || "—"}</td>
                    <td><SubscriptionPill row={row} /></td>
                    <td className="cap">{row.subscription_plan ?? "—"}</td>
                    <td>{row.scans_remaining}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Stores({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const [rows, setRows] = useState<StoreRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "paying" | "on" | "off">("all");
  const [error, setError] = useState<string | null>(null);

  function load() {
    adminApi.stores().then(setRows).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load stores."));
  }

  useEffect(load, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (rows ?? []).filter((row) => {
      if (filter === "paying" && !(row.subscription_status === "active" && row.subscription_plan)) return false;
      if (filter === "on" && !row.subscription_enforced) return false;
      if (filter === "off" && row.subscription_enforced) return false;
      if (!needle) return true;
      return [row.name, row.owner_name, row.owner_email, row.subscription_plan, row.subscription_status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [rows, query, filter]);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <PageHeader title="Stores" subtitle="Open a store to turn its subscription on or off, or to adjust scans." />
      <div className="toolbar">
        <input className="search" placeholder="Search store, owner, or plan" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="segment">
          {(["all", "paying", "on", "off"] as const).map((item) => (
            <button key={item} className={filter === item ? "seg on" : "seg"} onClick={() => setFilter(item)}>
              {item === "all" ? "All" : item === "paying" ? "Paying" : item === "on" ? "Subscription on" : "Subscription off"}
            </button>
          ))}
        </div>
      </div>
      <section className="panel">
        {!rows ? <p className="sub">Loading…</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Owner</th>
                  <th>Subscription</th>
                  <th>Status</th>
                  <th>Plan scans</th>
                  <th>Extra</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="row" onClick={() => onSelect(row.id)}>
                    <td>
                      <div className="strong">{row.name}</div>
                      <div className="hint">{formatDate(row.created_at)}</div>
                    </td>
                    <td>
                      <div>{row.owner_name || "—"}</div>
                      <div className="hint">{row.owner_email}</div>
                    </td>
                    <td><SubscriptionPill row={row} /></td>
                    <td><StatusPill status={row.subscription_status} /></td>
                    <td>{row.plan_scans_remaining}</td>
                    <td>{row.topup_scans_remaining}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && <p className="empty">No stores match.</p>}
          </div>
        )}
      </section>
      {selected && <StoreDrawer id={selected} onClose={() => { onSelect(null); load(); }} />}
    </>
  );
}

function StoreDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [delta, setDelta] = useState("5");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<SubscriptionChoice | null>(null);

  useEffect(() => {
    adminApi.store(id).then(setStore).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load the store."));
  }, [id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (pending) setPending(null);
      else onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  async function adjust(sign: 1 | -1) {
    const amount = Number(delta);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError("Enter a whole number of scans.");
      return;
    }
    if (!note.trim()) {
      setError("Add a short note.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.adjustScans(id, sign * amount, note.trim());
      setStore(await adminApi.store(id));
      setNote("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update scans.");
    } finally {
      setBusy(false);
    }
  }

  async function applyOverride(choice: SubscriptionChoice) {
    setBusy(true);
    setError(null);
    try {
      await adminApi.setStoreSubscription(id, choice);
      setStore(await adminApi.store(id));
      setPending(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the subscription.");
    } finally {
      setBusy(false);
    }
  }

  const current: SubscriptionChoice = store?.subscription_override ?? "platform";

  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        {!store ? <p className="sub">Loading…</p> : (
          <>
            <div className="drawer-head">
              <div>
                <h1>{store.name}</h1>
                <p className="sub tight">{store.scans_remaining} scans left · {store.plan_scans_remaining} from the plan · {store.topup_scans_remaining} extra</p>
              </div>
              <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
            </div>
            <div className="facts">
              <Fact label="Opened" value={formatDate(store.created_at)} />
              <Fact label="Grace until" value={store.grace_until ? formatDate(store.grace_until) : "—"} />
              <Fact label="Stripe" value={store.has_stripe ? "Linked" : "Not linked"} />
              <Fact label="Status" value={store.subscription_status} />
            </div>

            <h2>Subscription</h2>
            <p className="sub tight">On requires a plan before this store can scan. Off lets them scan for free. Platform follows the switch in Settings.</p>
            <div className="segment">
              {(["platform", "on", "off"] as SubscriptionChoice[]).map((choice) => (
                <button
                  key={choice}
                  className={current === choice ? "seg on" : "seg"}
                  disabled={busy}
                  onClick={() => { if (choice !== current) setPending(choice); }}
                >
                  {choice === "platform" ? "Platform" : choice === "on" ? "On" : "Off"}
                </button>
              ))}
            </div>

            <h2>Team</h2>
            <ul className="people">
              {store.members.map((member) => (
                <li key={member.user_id}>
                  <div>
                    <div className="strong">{member.full_name}</div>
                    <div className="hint">{member.email}</div>
                  </div>
                  <span className="pill cap">{member.role}</span>
                </li>
              ))}
            </ul>

            <h2>Add or remove scans</h2>
            <div className="split">
              <input className="field" value={delta} onChange={(e) => setDelta(e.target.value)} aria-label="Number of scans" />
              <input className="field" placeholder="Why" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="actions">
              <button className="btn ghost" disabled={busy} onClick={() => adjust(-1)}>Remove</button>
              <button className="btn" disabled={busy} onClick={() => adjust(1)}>Add</button>
            </div>

            <h2>Recent scan history</h2>
            {store.ledger.length === 0 && <p className="sub">No scan history yet.</p>}
            <ul className="ledger">
              {store.ledger.map((entry) => (
                <li key={entry.id}>
                  <span className={entry.delta < 0 ? "delta down" : "delta up"}>{entry.delta > 0 ? "+" : ""}{entry.delta}</span>
                  <span>
                    <span className="cap">{entry.reason.replaceAll("_", " ")}</span>
                    {entry.note ? <span className="hint"> · {entry.note}</span> : null}
                  </span>
                  <span className="hint">{formatDate(entry.created_at)}</span>
                </li>
              ))}
            </ul>
            {error && <p className="error">{error}</p>}
          </>
        )}
      </aside>
      {pending && store && (
        <div className="modal-back" onClick={(event) => { event.stopPropagation(); setPending(null); }}>
          <div className="card modal" onClick={(event) => event.stopPropagation()}>
            <h1>{pending === "on" ? "Turn subscription on?" : pending === "off" ? "Turn subscription off?" : "Use the platform setting?"}</h1>
            <p className="sub">
              {pending === "on" && "This store will need a plan to scan. If they are not already paying and have never had a grace date, they get 14 days. Stripe is not charged from here."}
              {pending === "off" && (store.has_stripe
                ? "This store can scan without a plan, and scans will not be counted. Stripe keeps billing them until they cancel."
                : "This store can scan without a plan, and scans will not be counted.")}
              {pending === "platform" && "This store will follow the subscription switch in Settings."}
            </p>
            <div className="actions">
              <button className="btn ghost" onClick={() => setPending(null)}>Cancel</button>
              <button className="btn" disabled={busy} onClick={() => applyOverride(pending)}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Users({ onOpenStore }: { onOpenStore: (id: string) => void }) {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [onlyLoose, setOnlyLoose] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.users().then(setRows).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load users."));
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (rows ?? []).filter((row) => {
      if (onlyLoose && row.store_id) return false;
      if (!needle) return true;
      return [row.full_name, row.email, row.store_name, row.role].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [rows, query, onlyLoose]);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <PageHeader title="Users" subtitle="Everyone who has created an account, including people who have not opened a store yet." />
      <div className="toolbar">
        <input className="search" placeholder="Search name, email, or store" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className={onlyLoose ? "seg on" : "seg"} onClick={() => setOnlyLoose((value) => !value)}>No store yet</button>
      </div>
      <section className="panel">
        {!rows ? <p className="sub">Loading…</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Store</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th>Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className={row.store_id ? "row" : undefined} onClick={() => { if (row.store_id) onOpenStore(row.store_id); }}>
                    <td className="strong">{row.full_name}</td>
                    <td>{row.email || "—"}</td>
                    <td>{row.store_name ?? <span className="pill warn">No store</span>}</td>
                    <td className="cap">{row.role ?? "—"}</td>
                    <td>{formatDate(row.created_at)}</td>
                    <td>{formatDate(row.last_sign_in_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && <p className="empty">No users match.</p>}
          </div>
        )}
      </section>
    </>
  );
}

function Payments() {
  return (
    <>
      <PageHeader title="Payments" subtitle="Charges, refunds, and failed cards stay in Stripe. This page does not move money." />
      <section className="panel">
        <p>Open Stripe to see each payment, refund a charge, or update a card on file.</p>
        <a className="btn" href="https://dashboard.stripe.com/payments" target="_blank" rel="noreferrer">Open Stripe payments</a>
      </section>
    </>
  );
}

function Settings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi.settings().then((data) => setEnabled(data.subscription_mode)).catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Could not load settings.");
    });
  }, []);

  async function apply(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const data = await adminApi.setMode(next);
      setEnabled(data.subscription_mode);
      setConfirming(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="The platform switch applies to every store that is still set to Platform." />
      <section className="panel switch">
        <div>
          <strong>Subscription mode</strong>
          <p className="sub tight">
            Off: stores on Platform can scan, and those scans are not counted. On: a paying store spends one scan per successful invoice or delivery check. Stores that are not paying get 14 days the first time this is turned on. A store set to On or Off on its own page ignores this switch.
          </p>
        </div>
        <button className={enabled ? "btn danger" : "btn"} disabled={enabled === null || busy} onClick={() => setConfirming(!enabled)}>
          {enabled ? "Turn off" : "Turn on"}
        </button>
      </section>
      {error && <p className="error">{error}</p>}
      {confirming !== null && (
        <div className="modal-back" onClick={() => setConfirming(null)}>
          <div className="card modal" onClick={(event) => event.stopPropagation()}>
            <h1>{confirming ? "Turn subscription mode on?" : "Turn subscription mode off?"}</h1>
            <p className="sub">
              {confirming
                ? "Stores that are not already paying, and that follow the platform setting, get 14 days before scans are blocked. Turning this off later does not reset that date."
                : "Stores that follow the platform setting can scan again without a plan. Stores you turned on individually stay on."}
            </p>
            <div className="actions">
              <button className="btn ghost" onClick={() => setConfirming(null)}>Cancel</button>
              <button className="btn" disabled={busy} onClick={() => apply(confirming)}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      <p className="sub">{subtitle}</p>
    </header>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card stat-card">
      <div className="label">{label}</div>
      <div className="stat">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="cap">{value}</div>
    </div>
  );
}

function SubscriptionPill({ row }: { row: StoreRow }) {
  const custom = row.subscription_override != null;
  return (
    <span className={row.subscription_enforced ? "pill good" : "pill"}>
      {row.subscription_enforced ? "On" : "Off"}
      {custom ? "" : " · platform"}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status === "active" ? "good" : status === "past_due" ? "bad" : status === "trial" ? "warn" : "";
  return <span className={`pill cap ${tone}`}>{status.replaceAll("_", " ")}</span>;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
