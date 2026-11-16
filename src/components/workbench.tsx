"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Download,
  Fingerprint,
  Globe2,
  History,
  LayoutDashboard,
  LoaderCircle,
  Mic,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Store,
  Undo2,
  Users,
  Volume2,
  VolumeX,
  Wallet,
  X,
  AlertTriangle,
  BarChart3,
  Pencil,
  Database,
} from "lucide-react";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import {
  browserRecognition,
  gnaniRecognition,
  type VoiceHandle,
} from "@/lib/voice";
import {
  indiaDate,
  money,
  type Customer,
  type Entry,
  type Preview,
  type Snapshot,
} from "@/lib/shared";

const tabs = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "ledger", label: "Ledger", icon: BookOpen },
  { id: "customers", label: "Customers", icon: Users },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "guard", label: "KhataGuard", icon: ShieldCheck },
];
const languages = [
  { code: "hi-IN", name: "Hindi + English", native: "हिन्दी" },
  { code: "kn-IN", name: "Kannada + English", native: "ಕನ್ನಡ" },
  { code: "te-IN", name: "Telugu + English", native: "తెలుగు" },
  { code: "en-IN", name: "English", native: "English" },
];
const examples = [
  "Ravi ka 500 add karo, nahi 350.",
  "Suresh ne kal 200 diye.",
  "Ravi ka balance batao.",
  "Meena 250 credit; Sunita paid 100.",
];
async function api(body: unknown) {
  const response = await fetch("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Could not complete the request.");
  return result;
}
const initials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });

function TrendChart({
  data,
  large = false,
}: {
  data: Snapshot["chart"];
  large?: boolean;
}) {
  return (
    <div className={large ? "chart chart-large" : "chart"}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 12, right: 4, bottom: 0, left: -23 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--color-rule)"
            strokeDasharray="3 5"
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))}
          />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="chart-tooltip">
                  <strong>{label}</strong>
                  {payload.map((p) => (
                    <span key={String(p.dataKey)}>
                      {p.name}: {money(Number(p.value) * 100)}
                    </span>
                  ))}
                </div>
              ) : null
            }
          />
          <Area
            isAnimationActive={false}
            type="monotone"
            dataKey="credit"
            name="Credit given"
            stroke="var(--color-accent-2)"
            fill="var(--color-chart-fill)"
            strokeWidth={2.5}
          />
          <Area
            isAnimationActive={false}
            type="monotone"
            dataKey="payment"
            name="Payments received"
            stroke="var(--color-positive)"
            fill="var(--color-chart-payment)"
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Workbench() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("overview");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [period, setPeriod] = useState("all");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [customerDialog, setCustomerDialog] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [entryDialog, setEntryDialog] = useState(false);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("hi-IN");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ack, setAck] = useState(false);
  const [overrides, setOverrides] = useState<
    Record<string, { customerId?: string; amount?: string; date?: string }>
  >({});
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [voiceOn, setVoiceOn] = useState(false);
  const [expandedAudit, setExpandedAudit] = useState("");
  const voice = useRef<VoiceHandle | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const assistant = useRef<HTMLElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const requestLock = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
      setLoadError("");
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Could not load the ledger.",
      );
    }
  }, []);
  useEffect(() => {
    void refresh();
    const read = () => {
      const p = new URLSearchParams(location.search);
      setTab(
        tabs.some((t) => t.id === p.get("tab")) ? p.get("tab")! : "overview",
      );
      setQuery(p.get("q") || "");
      setKind(p.get("kind") || "all");
      setPeriod(p.get("period") || "all");
      setSelectedCustomer(p.get("customer") || "");
    };
    read();
    window.addEventListener("popstate", read);
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        input.current?.focus();
        assistant.current?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener("keydown", key);
      voice.current?.stop();
      audio.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  function updateUrl(changes: Record<string, string>) {
    const p = new URLSearchParams(location.search);
    Object.entries(changes).forEach(([k, v]) =>
      v && v !== "all" && v !== "overview" ? p.set(k, v) : p.delete(k),
    );
    history.pushState(null, "", `${location.pathname}${p.size ? `?${p}` : ""}`);
  }
  function go(value: string) {
    setTab(value);
    setQuery("");
    setSelectedCustomer("");
    updateUrl({ tab: value, q: "", customer: "" });
  }
  function search(value: string) {
    setQuery(value);
    updateUrl({ q: value });
  }
  async function speak(message: string) {
    if (!voiceOn) return;
    try {
      audio.current?.pause();
      window.speechSynthesis?.cancel();
      if (data?.providers.gnaniVoice) {
        const res = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message, language: "en-IN" }),
        });
        if (!res.ok)
          throw new Error(
            "Voice reply failed. The written result is available.",
          );
        if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
        audioUrl.current = URL.createObjectURL(await res.blob());
        audio.current = new Audio(audioUrl.current);
        await audio.current.play();
      } else if (window.speechSynthesis) {
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = "en-IN";
        window.speechSynthesis.speak(utterance);
      } else throw new Error("Browser voice replies are unavailable.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not play voice reply.");
    }
  }
  async function work(fn: () => Promise<void>) {
    if (requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
      requestLock.current = false;
    }
  }
  function showPreview(result: Preview) {
    setPreview(result);
    setAck(false);
    setOverrides({});
    assistant.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const reply = result.blocked
      ? result.actions.find((a) => a.needsClarification)?.question
      : result.answers.length
        ? result.answers.join(" ")
        : "Please review the transaction before recording.";
    if (reply) void speak(reply);
  }
  async function submitCommand(value = text) {
    if (!value.trim()) return;
    voice.current?.stop();
    setListening(false);
    await work(async () => {
      const result = await api({ op: "preview", text: value });
      showPreview(result);
    });
  }
  async function startVoice() {
    if (listening) {
      voice.current?.stop();
      setListening(false);
      return;
    }
    setError("");
    setText("");
    setListening(true);
    let transcript = "";
    try {
      const onText = (value: string, final: boolean) => {
        transcript = value;
        setText(value);
        if (final) {
          setListening(false);
          void submitCommand(value);
        }
      };
      const end = () => {
        setListening(false);
        setLevel(0);
      };
      const fail = (message: string) => {
        setError(message);
        end();
      };
      voice.current = data?.providers.gnaniVoice
        ? await gnaniRecognition(language, onText, end, fail, setLevel)
        : browserRecognition(language, onText, end, fail);
    } catch (e) {
      setListening(false);
      setError(e instanceof Error ? e.message : "Microphone is unavailable.");
    }
  }
  async function confirm() {
    if (!preview) return;
    await work(async () => {
      const result = await api({
        op: "commit",
        commandId: preview.id,
        acknowledge: ack,
      });
      setPreview(null);
      setText("");
      const message = [result.message, ...(result.answers ?? [])].join(" ");
      setNotice(message);
      await refresh();
      await speak(message);
    });
  }
  async function discard() {
    if (!preview) return;
    await work(async () => {
      await api({ op: "cancel", commandId: preview.id });
      setPreview(null);
      setText("");
    });
  }
  async function clarify() {
    if (!preview) return;
    await work(async () => {
      showPreview(
        await api({ op: "clarify", commandId: preview.id, overrides }),
      );
    });
  }
  function editCustomer(customer?: Customer) {
    setEditing(customer ?? null);
    setError("");
    setCustomerDialog(true);
  }
  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await work(async () => {
      await api({
        op: "customer",
        ...(editing ? { id: editing.id } : {}),
        name: String(form.get("name")),
        phone: String(form.get("phone")),
        nicknames: String(form.get("nicknames")),
      });
      setCustomerDialog(false);
      setNotice(
        editing ? "Customer details updated." : "Customer added to your khata.",
      );
      await refresh();
    });
  }
  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await work(async () => {
      const result = await api({
        op: "manual",
        customerId: String(form.get("customer")),
        kind: String(form.get("kind")),
        amount: String(form.get("amount")),
        date: String(form.get("date")),
        note: String(form.get("note")),
      });
      setEntryDialog(false);
      showPreview(result);
    });
  }
  async function reverse(entry: Entry) {
    await work(async () => {
      showPreview(await api({ op: "reverse", entryId: entry.id }));
    });
  }
  const filteredCustomers =
    data?.customers.filter((c) =>
      `${c.name} ${c.phone} ${c.nicknames}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  const rows =
    data?.entries.filter(
      (e) =>
        `${e.customer.name} ${e.note}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (kind === "all" || e.kind === kind) &&
        (period !== "today" || e.occurredOn === data.today) &&
        (!selectedCustomer || e.customerId === selectedCustomer),
    ) ?? [];
  const selected = data?.customers.find((c) => c.id === selectedCustomer);
  const today = new Date(
    `${data?.today || indiaDate()}T12:00:00+05:30`,
  ).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  function entryTable(entries: Entry[]) {
    return entries.length ? (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Transaction</th>
              <th>Amount</th>
              <th>Date</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.id}
                className={entry.reversedBy ? "row-reversed" : ""}
              >
                <td>
                  <button
                    className="customer-link"
                    onClick={() => {
                      setSelectedCustomer(entry.customerId);
                      setTab("ledger");
                      updateUrl({ tab: "ledger", customer: entry.customerId });
                    }}
                  >
                    <span
                      className={`avatar tone-${entry.customer.name.length % 4}`}
                    >
                      {initials(entry.customer.name)}
                    </span>
                    <span>
                      <strong>{entry.customer.name}</strong>
                      <small>{entry.note || `${entry.source} entry`}</small>
                    </span>
                  </button>
                </td>
                <td>
                  <span className={`transaction-type ${entry.kind}`}>
                    <span>
                      {entry.kind === "payment" ? (
                        <ArrowDownLeft size={13} />
                      ) : entry.kind === "reversal" ? (
                        <Undo2 size={13} />
                      ) : (
                        <ArrowUpRight size={13} />
                      )}
                    </span>
                    {entry.reversedBy
                      ? "Reversed"
                      : entry.kind === "payment"
                        ? "Payment"
                        : entry.kind === "reversal"
                          ? "Reversal"
                          : "Credit given"}
                  </span>
                </td>
                <td className="amount">
                  {entry.kind === "reversal" && entry.amountPaise < 0
                    ? "−"
                    : ""}
                  {money(Math.abs(entry.amountPaise))}
                </td>
                <td className="date-cell">
                  {dateLabel(entry.occurredOn)}
                  <small>
                    {new Date(entry.createdAt).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Kolkata",
                    })}
                  </small>
                </td>
                <td>
                  {!entry.reversesId && !entry.reversedBy ? (
                    <button
                      className="icon-button undo-button"
                      title={`Undo ${entry.customer.name} transaction`}
                      aria-label={`Undo ${entry.customer.name} transaction`}
                      disabled={busy}
                      onClick={() => void reverse(entry)}
                    >
                      <Undo2 size={16} />
                    </button>
                  ) : (
                    <CheckCheck size={16} className="muted" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="empty">
        <BookOpen size={28} />
        <h3>No transactions here yet</h3>
        <p>Add an entry or adjust your filters.</p>
        <Button variant="outline" onClick={() => setEntryDialog(true)}>
          <Plus size={16} />
          New entry
        </Button>
      </div>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to ledger
      </a>
      <header className="app-header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label="KhataX OS home">
            <span className="brand-mark">
              <BookOpen size={23} strokeWidth={2} />
            </span>
            <span>
              khata<span className="brand-x">x</span>
            </span>
            <span className="os-label">OS</span>
          </a>
          <nav aria-label="Main navigation">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? "nav-link active" : "nav-link"}
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => go(t.id)}
              >
                <t.icon size={16} />
                {t.label}
              </button>
            ))}
          </nav>
          <button
            className="shop-profile"
            onClick={() => setSettings(true)}
            aria-label="Shop and provider settings"
          >
            <span className="shop-avatar">
              <Store size={18} />
            </span>
            <span>
              My kirana<small>Sample shop</small>
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </header>
      <main id="main" className="workspace">
        <div className="page-heading">
          <div>
            <p className="date-heading">{today}</p>
            <h1>
              {tab === "overview"
                ? "Your shop, in good books."
                : tab === "ledger"
                  ? selected
                    ? `${selected.name}’s khata`
                    : "Every entry. All accounted for."
                  : tab === "customers"
                    ? "Familiar faces. Clear balances."
                    : tab === "insights"
                      ? "A little clarity for your day."
                      : "Your khata has a safety net."}
            </h1>
            <p className="heading-description">
              {tab === "overview"
                ? "Less bookkeeping. More dukaan. Here’s where your business stands."
                : tab === "ledger"
                  ? "A complete record of credit, payments, and corrections."
                  : tab === "customers"
                    ? "Your customer relationships, with every rupee in the right place."
                    : tab === "insights"
                      ? "Real numbers from your ledger. A better picture of your business."
                      : "Every change leaves a trail. Every important action gets a second look."}
            </p>
          </div>
          <div className="heading-actions">
            <Button variant="outline" onClick={() => editCustomer()}>
              <Users size={16} />
              Add customer
            </Button>
            <Button
              onClick={() => {
                setError("");
                setEntryDialog(true);
              }}
            >
              <Plus size={17} />
              New entry
            </Button>
          </div>
        </div>
        {loadError ? (
          <div className="load-error" role="alert">
            <AlertTriangle size={20} />
            <span>{loadError}</span>
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        ) : !data ? (
          <div className="loading-view" aria-busy="true">
            <LoaderCircle className="spin" size={25} />
            <p>Opening your khata…</p>
          </div>
        ) : (
          <>
            <section className="stats" aria-label="Financial summary">
              <div className="stat">
                <span>Total outstanding</span>
                <strong>{money(data.summary.outstanding)}</strong>
                <small>
                  {data.summary.activeCustomers} customers with open balances
                </small>
              </div>
              <div className="stat">
                <span>Credit given today</span>
                <strong>{money(data.summary.todayCredit)}</strong>
                <small>
                  <ArrowUpRight size={13} /> Added to customer khatas
                </small>
              </div>
              <div className="stat">
                <span>Payments today</span>
                <strong className="positive">
                  {money(data.summary.todayPayment)}
                </strong>
                <small>
                  <ArrowDownLeft size={13} /> Received from customers
                </small>
              </div>
              <div className="stat">
                <span>Your customers</span>
                <strong>
                  {data.customers.length.toString().padStart(2, "0")}
                </strong>
                <small>
                  {data.summary.advance
                    ? `${money(data.summary.advance)} held in advances`
                    : "Relationships that keep you going"}
                </small>
              </div>
            </section>
            <div className="workbench-grid">
              <div className="main-column">
                {tab === "overview" && (
                  <>
                    <section className="panel activity-panel">
                      <div className="section-header">
                        <div>
                          <h2>The week in your khata</h2>
                          <p>Credit and collections, at a glance</p>
                        </div>
                        <span className="period-label">
                          Last 7 days
                          <ChevronDown size={13} />
                        </span>
                      </div>
                      <div className="chart-legend">
                        <span>
                          <i className="legend-credit" />
                          Credit given
                        </span>
                        <span>
                          <i className="legend-payment" />
                          Payments received
                        </span>
                      </div>
                      <TrendChart data={data.chart} />
                    </section>
                    <section className="ledger-section">
                      <div className="section-header">
                        <h2>
                          Recent transactions{" "}
                          <span className="count-tag">
                            {data.entries.length}
                          </span>
                        </h2>
                        <button
                          className="text-button"
                          onClick={() => go("ledger")}
                        >
                          View ledger
                          <ArrowRight size={15} />
                        </button>
                      </div>
                      {entryTable(data.entries.slice(0, 5))}
                    </section>
                  </>
                )}
                {tab === "ledger" && (
                  <section className="ledger-section full-ledger">
                    <div className="section-header">
                      <div>
                        <h2>
                          {selected ? "Customer history" : "Transaction ledger"}{" "}
                          <span className="count-tag">{rows.length}</span>
                        </h2>
                        {selected && (
                          <p>
                            Balance:{" "}
                            <strong>{money(selected.balancePaise)}</strong>{" "}
                            <button
                              className="text-button"
                              onClick={() => {
                                setSelectedCustomer("");
                                updateUrl({ customer: "" });
                              }}
                            >
                              Show all customers
                              <X size={13} />
                            </button>
                          </p>
                        )}
                      </div>
                      <a className="text-button" href="/api/export">
                        <Download size={15} />
                        Export CSV
                      </a>
                    </div>
                    <div className="filters">
                      <label className="search-field">
                        <Search size={16} />
                        <input
                          aria-label="Search transactions"
                          placeholder="Search customer or note…"
                          value={query}
                          onChange={(e) => search(e.target.value)}
                        />
                      </label>
                      <select
                        aria-label="Transaction type"
                        value={kind}
                        onChange={(e) => {
                          setKind(e.target.value);
                          updateUrl({ kind: e.target.value });
                        }}
                      >
                        <option value="all">All transactions</option>
                        <option value="credit">Credit given</option>
                        <option value="payment">Payments</option>
                        <option value="reversal">Reversals</option>
                      </select>
                      <select
                        aria-label="Transaction date"
                        value={period}
                        onChange={(e) => {
                          setPeriod(e.target.value);
                          updateUrl({ period: e.target.value });
                        }}
                      >
                        <option value="all">All dates</option>
                        <option value="today">Today</option>
                      </select>
                    </div>
                    {entryTable(rows)}
                  </section>
                )}
                {tab === "customers" && (
                  <section className="ledger-section customer-section">
                    <div className="section-header">
                      <h2>
                        Customer book{" "}
                        <span className="count-tag">
                          {data.customers.length}
                        </span>
                      </h2>
                      <span className="muted">Balances in INR</span>
                    </div>
                    <label className="search-field customer-search">
                      <Search size={17} />
                      <input
                        placeholder="Find a name, nickname, or number…"
                        aria-label="Search customers"
                        value={query}
                        onChange={(e) => search(e.target.value)}
                      />
                    </label>
                    {filteredCustomers.length ? (
                      <div className="customer-list">
                        {filteredCustomers.map((c) => (
                          <div className="customer-row" key={c.id}>
                            <button
                              className="customer-link"
                              onClick={() => {
                                setSelectedCustomer(c.id);
                                setTab("ledger");
                                updateUrl({
                                  tab: "ledger",
                                  customer: c.id,
                                  q: "",
                                });
                                setQuery("");
                              }}
                            >
                              <span
                                className={`avatar tone-${c.name.length % 4}`}
                              >
                                {initials(c.name)}
                              </span>
                              <span>
                                <strong>{c.name}</strong>
                                <small>{c.phone || "No phone added"}</small>
                              </span>
                            </button>
                            <div className="customer-balance">
                              <strong>{money(Math.abs(c.balancePaise))}</strong>
                              <small>
                                {c.balancePaise < 0
                                  ? "Advance"
                                  : c.balancePaise === 0
                                    ? "All settled"
                                    : "Outstanding"}
                              </small>
                            </div>
                            <button
                              className="icon-button"
                              aria-label={`Edit ${c.name}`}
                              onClick={() => editCustomer(c)}
                            >
                              <Pencil size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty">
                        <Users size={28} />
                        <h3>No customers found</h3>
                        <p>Add a customer or try another search.</p>
                        <Button
                          variant="outline"
                          onClick={() => editCustomer()}
                        >
                          Add customer
                        </Button>
                      </div>
                    )}
                  </section>
                )}
                {tab === "insights" && (
                  <>
                    <section className="panel">
                      <div className="section-header">
                        <div>
                          <h2>How your week adds up</h2>
                          <p>Amounts reflect active entries after reversals.</p>
                        </div>
                        <BarChart3 size={20} />
                      </div>
                      <div className="chart-legend">
                        <span>
                          <i className="legend-credit" />
                          Credit given
                        </span>
                        <span>
                          <i className="legend-payment" />
                          Payments received
                        </span>
                      </div>
                      <TrendChart data={data.chart} large />
                    </section>
                    <section className="ledger-section">
                      <div className="section-header">
                        <h2>Outstanding by customer</h2>
                        <Wallet size={19} />
                      </div>
                      <div className="balance-bars">
                        {[...data.customers]
                          .filter((c) => c.balancePaise > 0)
                          .sort((a, b) => b.balancePaise - a.balancePaise)
                          .map((c) => (
                            <button
                              className="balance-bar"
                              key={c.id}
                              onClick={() => {
                                setSelectedCustomer(c.id);
                                setTab("ledger");
                                updateUrl({ tab: "ledger", customer: c.id });
                              }}
                            >
                              <span>
                                {c.name}
                                <strong>{money(c.balancePaise)}</strong>
                              </span>
                              <meter
                                value={c.balancePaise}
                                min={0}
                                max={Math.max(
                                  ...data.customers.map((c) => c.balancePaise),
                                  1,
                                )}
                              >
                                {money(c.balancePaise)}
                              </meter>
                            </button>
                          ))}
                        {!data.summary.outstanding && (
                          <div className="empty">
                            <CheckCheck size={28} />
                            <h3>All khatas are settled</h3>
                          </div>
                        )}
                      </div>
                    </section>
                  </>
                )}
                {tab === "guard" && (
                  <>
                    <section className="guard-intro">
                      <span className="guard-seal">
                        <ShieldCheck size={27} />
                      </span>
                      <div>
                        <h2>Trust, built into every transaction.</h2>
                        <p>
                          {data.summary.protectedEntries} ledger entries
                          preserved. Corrections use linked reversals, so the
                          original story is always there.
                        </p>
                      </div>
                    </section>
                    <div className="safety-features">
                      <span>
                        <Fingerprint size={17} />
                        Customer identity checks
                      </span>
                      <span>
                        <AudioLines size={17} />
                        Amount clarification
                      </span>
                      <span>
                        <CheckCheck size={17} />
                        Duplicate detection
                      </span>
                      <span>
                        <History size={17} />
                        Auditable reversals
                      </span>
                    </div>
                    <section className="ledger-section">
                      <div className="section-header">
                        <div>
                          <h2>Audit trail</h2>
                          <p>The latest 150 events, newest first</p>
                        </div>
                        <History size={19} />
                      </div>
                      <div className="audit-list">
                        {data.audits.map((a) => (
                          <div className="audit-item" key={a.id}>
                            <button
                              onClick={() =>
                                setExpandedAudit(
                                  expandedAudit === a.id ? "" : a.id,
                                )
                              }
                              aria-expanded={expandedAudit === a.id}
                            >
                              <span className="audit-icon">
                                {a.event.includes("revers") ? (
                                  <Undo2 size={16} />
                                ) : (
                                  <Check size={16} />
                                )}
                              </span>
                              <span>
                                <strong>
                                  {a.event
                                    .replaceAll(".", " ")
                                    .replaceAll("seeded", "sample entry")}
                                </strong>
                                <small>
                                  {new Date(a.createdAt).toLocaleString(
                                    "en-IN",
                                    {
                                      timeZone: "Asia/Kolkata",
                                      day: "numeric",
                                      month: "short",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    },
                                  )}
                                </small>
                              </span>
                              <ChevronRight size={16} />
                            </button>
                            {expandedAudit === a.id && (
                              <pre>
                                {JSON.stringify(JSON.parse(a.detail), null, 2)}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  </>
                )}
              </div>
              <aside
                className="assistant"
                ref={assistant}
                aria-label="DukaanOS voice assistant"
              >
                <div className="assistant-top">
                  <div>
                    <span className="assistant-symbol">
                      <AudioLines size={18} />
                    </span>
                    <strong>DukaanOS</strong>
                    {!data.providers.gnaniVoice && (
                      <small className="demo-badge">Browser demo</small>
                    )}
                  </div>
                  <button
                    className="icon-button"
                    aria-label={
                      voiceOn ? "Disable voice replies" : "Enable voice replies"
                    }
                    aria-pressed={voiceOn}
                    onClick={() => {
                      setVoiceOn(!voiceOn);
                      if (voiceOn) {
                        window.speechSynthesis?.cancel();
                        audio.current?.pause();
                      }
                    }}
                  >
                    {voiceOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
                  </button>
                </div>
                {!preview ? (
                  <>
                    <div className="voice-title">
                      <h2>
                        Just say it.
                        <br />
                        We’ll write it.
                      </h2>
                      <p>
                        One voice. Every transaction.
                        <br />
                        Any language.
                      </p>
                    </div>
                    <div className="mic-stage">
                      <div
                        className={`mic-rings ${listening ? "is-listening" : ""}`}
                      >
                        <button
                          className="mic-button"
                          aria-label={
                            listening ? "Stop listening" : "Start voice command"
                          }
                          disabled={busy}
                          onClick={() => void startVoice()}
                        >
                          {listening ? (
                            <Square size={24} fill="currentColor" />
                          ) : (
                            <Mic size={30} strokeWidth={1.7} />
                          )}
                        </button>
                      </div>
                      <div
                        className={`waveform ${listening ? "live" : ""}`}
                        aria-hidden="true"
                      >
                        {Array.from({ length: 27 }, (_, i) => (
                          <span
                            key={i}
                            style={{
                              transform: `scaleY(${listening ? Math.max(0.12, Math.min(1, 0.2 + level * 5)) * [0.4, 0.7, 1, 0.6, 0.8][i % 5] : [0.12, 0.2, 0.35, 0.5, 0.3, 0.65, 0.45, 0.75, 0.9, 0.55, 1, 0.7, 0.45][i % 13]})`,
                            }}
                          />
                        ))}
                      </div>
                      <span className="mic-instruction">
                        {busy
                          ? "Understanding your command…"
                          : listening
                            ? "Listening… speak naturally"
                            : "Tap the mic. Speak naturally."}
                      </span>
                    </div>
                    <label className="language-select">
                      <Globe2 size={15} />
                      <select
                        aria-label="Voice language"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        disabled={listening}
                      >
                        {languages.map((l) => (
                          <option key={l.code} value={l.code}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} />
                    </label>
                    <div className="examples">
                      <p>Try saying</p>
                      {examples.slice(0, 3).map((example, i) => (
                        <button
                          key={example}
                          disabled={busy || listening}
                          onClick={() => {
                            setText(example);
                            void submitCommand(example);
                          }}
                        >
                          <span>“{example}”</span>
                          <ArrowUpRight size={14} />
                          {i === 1 && <small>Relative dates</small>}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="preview-area" aria-live="polite">
                    <div className="preview-heading">
                      <span
                        className={
                          preview.blocked
                            ? "review-icon warning"
                            : "review-icon"
                        }
                      >
                        {preview.blocked ? (
                          <CircleHelp size={21} />
                        ) : (
                          <ShieldCheck size={21} />
                        )}
                      </span>
                      <h2>
                        {preview.blocked
                          ? "A quick double-check."
                          : preview.actions.every((a) =>
                                ["balance", "summary"].includes(a.kind),
                              )
                            ? "Here’s your answer."
                            : "Heard you. Let’s check."}
                      </h2>
                    </div>
                    <blockquote>“{preview.transcript}”</blockquote>
                    <div className="preview-actions">
                      {preview.actions.map((action, i) => (
                        <div className="preview-action" key={i}>
                          <div>
                            <span className="action-number">{i + 1}</span>
                            <strong>
                              {action.kind === "undo"
                                ? "Reverse transaction"
                                : action.kind === "correct"
                                  ? "Correct transaction"
                                  : action.kind === "balance"
                                    ? "Check balance"
                                    : action.kind === "summary"
                                      ? "Shop summary"
                                      : action.kind === "credit"
                                        ? "Add credit"
                                        : "Record payment"}
                            </strong>
                            {action.amountPaise != null && (
                              <b>{money(action.amountPaise)}</b>
                            )}
                          </div>
                          <p>
                            {action.customerName ?? "Your shop"}
                            {action.occurredOn
                              ? ` / ${dateLabel(action.occurredOn)}`
                              : ""}
                          </p>
                          {action.needsClarification && (
                            <div className="clarification">
                              <p>{action.question}</p>
                              {action.candidates?.length ? (
                                <select
                                  aria-label={`Choose customer for action ${i + 1}`}
                                  defaultValue=""
                                  onChange={(e) =>
                                    setOverrides({
                                      ...overrides,
                                      [i]: {
                                        ...overrides[i],
                                        customerId: e.target.value,
                                      },
                                    })
                                  }
                                >
                                  <option value="" disabled>
                                    Select the right customer
                                  </option>
                                  {action.candidates.map((c) => (
                                    <option value={c.id} key={c.id}>
                                      {c.name}{" "}
                                      {c.phone ? `(${c.phone.slice(-4)})` : ""}
                                    </option>
                                  ))}
                                </select>
                              ) : null}
                              {(!action.amountPaise ||
                                /amount/i.test(action.question ?? "")) &&
                                ["credit", "payment", "correct"].includes(
                                  action.kind,
                                ) && (
                                  <input
                                    aria-label={`Exact rupee amount for action ${i + 1}`}
                                    placeholder="Exact amount in rupees"
                                    inputMode="decimal"
                                    onChange={(e) =>
                                      setOverrides({
                                        ...overrides,
                                        [i]: {
                                          ...overrides[i],
                                          amount: e.target.value,
                                        },
                                      })
                                    }
                                  />
                                )}
                              {/date|yesterday/i.test(
                                action.question ?? "",
                              ) && (
                                <input
                                  type="date"
                                  aria-label={`Transaction date for action ${i + 1}`}
                                  max={data.today}
                                  onChange={(e) =>
                                    setOverrides({
                                      ...overrides,
                                      [i]: {
                                        ...overrides[i],
                                        date: e.target.value,
                                      },
                                    })
                                  }
                                />
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {preview.answers.map((answer) => (
                      <p className="answer" key={answer}>
                        {answer}
                      </p>
                    ))}
                    {preview.warnings.length > 0 && (
                      <div className="safety-warning">
                        <AlertTriangle size={17} />
                        <div>
                          {preview.warnings.map((w) => (
                            <p key={w}>{w}</p>
                          ))}
                          <label>
                            <input
                              type="checkbox"
                              checked={ack}
                              onChange={(e) => setAck(e.target.checked)}
                            />
                            I’ve checked this and want to proceed.
                          </label>
                        </div>
                      </div>
                    )}
                    <div className="review-controls">
                      {preview.blocked ? (
                        <Button
                          onClick={() => void clarify()}
                          disabled={busy || !Object.keys(overrides).length}
                        >
                          {busy ? (
                            <LoaderCircle className="spin" size={16} />
                          ) : (
                            <Check size={16} />
                          )}
                          Check again
                        </Button>
                      ) : (
                        <Button
                          onClick={() => void confirm()}
                          disabled={busy || (!!preview.warnings.length && !ack)}
                        >
                          {busy ? (
                            <LoaderCircle className="spin" size={16} />
                          ) : (
                            <CheckCheck size={16} />
                          )}{" "}
                          {preview.actions.every((a) =>
                            ["balance", "summary"].includes(a.kind),
                          )
                            ? "Done"
                            : "Confirm & record"}
                        </Button>
                      )}
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void discard()}
                      >
                        {preview.actions.every((a) =>
                          ["balance", "summary"].includes(a.kind),
                        )
                          ? "Ask something else"
                          : "Discard"}
                      </button>
                    </div>
                    <span className="provider-note">
                      Understood by {preview.provider}
                    </span>
                  </div>
                )}
                <div className="assistant-bottom">
                  {error && !customerDialog && !entryDialog && (
                    <div className="assistant-error" role="alert">
                      <AlertTriangle size={15} />
                      <span>{error}</span>
                      <button
                        aria-label="Dismiss error"
                        onClick={() => setError("")}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <form
                    className="command-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitCommand();
                    }}
                  >
                    <textarea
                      ref={input}
                      rows={1}
                      placeholder="Or type a command…"
                      aria-label="Type a ledger command"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void submitCommand();
                        }
                      }}
                      disabled={busy || listening || !!preview}
                    />
                    <button
                      type="submit"
                      disabled={busy || !text.trim() || !!preview}
                      aria-label="Understand command"
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <ArrowRight size={19} />
                      )}
                    </button>
                  </form>
                  <div className="assistant-meta">
                    <span>
                      <ShieldCheck size={12} />
                      You confirm. Then we record.
                    </span>
                    <kbd>Ctrl K</kbd>
                  </div>
                </div>
              </aside>
            </div>
            <footer className="workspace-footer">
              <span>
                <Database size={13} />
                Saved in {data.storage.toLowerCase()}
              </span>
              <span>
                Sample data for demonstration{" "}
                <button onClick={() => setSettings(true)}>
                  Provider setup
                  <Settings2 size={12} />
                </button>
              </span>
              <span>Made for the heart of your neighbourhood.</span>
            </footer>
          </>
        )}
      </main>
      {notice && (
        <div className="toast" role="status">
          <span>
            <CheckCheck size={19} />
          </span>
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <Dialog
        open={customerDialog}
        onOpenChange={setCustomerDialog}
        title={editing ? "Edit customer" : "A new face in your khata"}
        description="Add their details. Nicknames help match voice commands to the right person."
      >
        <form
          onSubmit={saveCustomer}
          className="dialog-form"
          key={editing?.id || "new"}
        >
          <label>
            Full name
            <input
              name="name"
              autoComplete="name"
              defaultValue={editing?.name}
              placeholder="e.g. Priya Verma"
              required
              minLength={2}
              maxLength={80}
            />
          </label>
          <label>
            Mobile number <span className="optional">optional</span>
            <input
              name="phone"
              type="tel"
              autoComplete="tel"
              defaultValue={editing?.phone}
              placeholder="10-digit Indian mobile number"
            />
          </label>
          <label>
            Nicknames <span className="optional">optional</span>
            <input
              name="nicknames"
              defaultValue={editing?.nicknames}
              placeholder="e.g. Priya, Priya ji, प्रिया"
              maxLength={200}
            />
            <small>Separate nicknames with commas.</small>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <Button
              variant="outline"
              type="button"
              onClick={() => setCustomerDialog(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              {editing ? "Save changes" : "Add customer"}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={entryDialog}
        onOpenChange={setEntryDialog}
        title="A new entry, done right."
        description="Every rupee goes through a quick review before it enters the ledger."
      >
        <form className="dialog-form" onSubmit={saveEntry}>
          <label>
            Customer
            <select
              name="customer"
              required
              defaultValue={selectedCustomer || ""}
            >
              <option value="" disabled>
                Choose a customer
              </option>
              {data?.customers.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              Transaction type
              <select name="kind">
                <option value="credit">Credit given (udhaar)</option>
                <option value="payment">Payment received</option>
              </select>
            </label>
            <label>
              Amount in rupees
              <input
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                required
                pattern="[0-9]+(\.[0-9]{1,2})?"
              />
            </label>
          </div>
          <label>
            Transaction date
            <input
              name="date"
              type="date"
              defaultValue={data?.today || indiaDate()}
              max={data?.today || indiaDate()}
              required
            />
          </label>
          <label>
            Note <span className="optional">optional</span>
            <input
              name="note"
              placeholder="e.g. Rice, dal, and monthly groceries"
              maxLength={300}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <Button
              variant="outline"
              type="button"
              onClick={() => setEntryDialog(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ShieldCheck size={16} />
              )}
              Review entry
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={settings}
        onOpenChange={setSettings}
        title="Your shop’s connections"
        description="Credentials stay on the server. The interface always shows which provider is in use."
      >
        <div className="provider-list">
          <div>
            <Sparkles size={20} />
            <span>
              <strong>Intent understanding</strong>
              <small>{data?.providers.llm || "Loading…"}</small>
            </span>
          </div>
          <div>
            <Mic size={20} />
            <span>
              <strong>BhashaBridge speech recognition</strong>
              <small>{data?.providers.stt || "Loading…"}</small>
            </span>
          </div>
          <div>
            <Volume2 size={20} />
            <span>
              <strong>Spoken replies</strong>
              <small>{data?.providers.tts || "Loading…"}</small>
            </span>
          </div>
        </div>
        <p className="setup-note">
          Add your OpenAI and Gnani keys to Vercel’s Production environment, or
          the local <code>.env.local</code> file for development. Redeploy or
          restart after changes. Browser speech and the limited local parser are
          labeled demo modes. Full code-mixed understanding uses the LLM.
        </p>
        <p className="setup-note">
          This is a single-shop hackathon build. Sample customers and entries
          are labeled in the ledger. New entries persist in SQLite.
        </p>
        <Button variant="outline" onClick={() => setSettings(false)}>
          Back to my khata
        </Button>
      </Dialog>
    </>
  );
}
