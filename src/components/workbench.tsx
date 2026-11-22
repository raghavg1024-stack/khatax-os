Warning: truncated output (original token count: 19693)
Total output lines: 1978

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
  CalendarDays,
  Command,
} from "lucide-react";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import dynamic from "next/dynamic";
import {offlineDrafts,saveOfflineDraft,recordOfflineVoice,type OfflineDraft} from "@/lib/offline";
const ShopTools=dynamic(()=>import("./shop-tools"),{ssr:false});
import {
  browserRecognition,
  streamingRecognition,
  type VoiceHandle,
} from "@/lib/voice";
import { AUTO_LANGUAGE, LANGUAGES } from "@/lib/languages";
import { conversationFollowup, replyLanguage as inferReplyLanguage } from "@/lib/conversation";
import { beginsCustomerConversation, advanceCustomer, draftQuestion, type CustomerDraft } from "@/lib/customer-conversation";
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
  const [shopToolsOpen,setShopToolsOpen]=useState(false);
  const [shopCommand,setShopCommand]=useState("");
  const [offlineCount,setOfflineCount]=useState(0);
  const [offlineRecording,setOfflineRecording]=useState(false);
  const preparedDraft=useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("auto");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ack, setAck] = useState(false);
  const [overrides, setOverrides] = useState<
    Record<string, { customerId?: string; amount?: string; date?: string }>
  >({});
  const [listening, setListening] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [recognitionMode, setRecognitionMode] = useState("server");
  const [voiceFinishing, setVoiceFinishing] = useState(false);
  const [level, setLevel] = useState(0);
  const [voiceOn, setVoiceOn] = useState(false);
  const voiceEnabled = useRef(false);
  const responseLanguage = useRef("en-IN");
  const [assistantReply, setAssistantReply] = useState("");
  const [customerDraft,setCustomerDraft] = useState<CustomerDraft|null>(null);
  const conversationActive = useRef(false);
  const nextVoiceTurn = useRef<()=>void>(()=>{});
  const [expandedAudit, setExpandedAudit] = useState("");
  const voice = useRef<VoiceHandle | null>(null);
  const voiceSession = useRef(0);
  const voiceStopRequested = useRef(false);
  const voiceLanguageInitialized = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const assistant = useRef<HTMLElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const replySession = useRef(0);
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
    const sync=()=>{void offlineDrafts().then(rows=>setOfflineCount(rows.length)).catch(()=>{});};
    sync();window.addEventListener("online",sync);
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
      window.removeEventListener("online",sync);
      voiceSession.current++;
      replySession.current++;
      voice.current?.stop();
      audio.current?.pause();
      window.speechSynthesis?.cancel();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!data || voiceLanguageInitialized.current) return;
    voiceLanguageInitialized.current = true;
    setLanguage(data.providers.sarvamVoice ? "auto" : "hi-IN");
  }, [data]);
  function updateUrl(changes: Record<string, string>) {
    const p = new URLSearchParams(location.search);
    Object.entries(changes).forEach(([k, v]) =>
      v && v !== "all" && v !== "overview" ? p.set(k, v) : p.delete(k),
    );
    history.pushState(null, "", `${location.pathname}${p.size ? `?${p}` : ""}`);
  }
  function go(value: string) {
    voiceSession.current++;
    voice.current?.stop();
    voice.current = null;
    setListening(false);
    setVoiceFinishing(false);
    voiceStopRequested.current = false;
    setLevel(0);
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
    const session = ++replySession.current;
    const spokenLanguage = responseLanguage.current;
    try {
      audio.current?.pause();
      window.speechSynthesis?.cancel();
      let responseText = message;
      if (spokenLanguage !== "en-IN" && data?.providers.sarvamVoice) {
        const translated = await apiReply(message, spokenLanguage);
        if (session !== replySession.current) return;
        responseText = translated;
      }
      setAssistantReply(responseText);
      if (!voiceEnabled.current) return;
      if (data?.providers.gnaniVoice || data?.providers.sarvamVoice) {
        const res = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: responseText, language: spokenLanguage }),
        });
        if (session !== replySession.current) return;
        if (res.status === 501 && window.speechSynthesis) {
          const matching = window.speechSynthesis.getVoices().find(v=>v.lang.split("-")[0] === spokenLanguage.split("-")[0]);
          if (!matching) throw new Error("A spoken voice is unavailable for this language. The translated reply is shown below.");
          const utterance = new SpeechSynthesisUtterance(responseText);
          utterance.lang = spokenLanguage;
          utterance.voice = matching;
          utterance.onend = () => { if (conversationActive.current && voiceEnabled.current) nextVoiceTurn.current(); };
          window.speechSynthesis.speak(utterance);
          return;
        }
        if (!res.ok)
          throw new Error(
            "Voice reply failed. The written result is available.",
          );
        const blob = await res.blob();
        if (session !== replySession.current) return;
        if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
        audioUrl.current = URL.createObjectURL(blob);
        audio.current = new Audio(audioUrl.current);
        audio.current.onended = () => { if (conversationActive.current && voiceEnabled.current) nextVoiceTurn.current(); };
        await audio.current.play();
      } else if (window.speechSynthesis) {
        const utterance = new SpeechSynthesisUtterance(responseText);
        utterance.lang = spokenLanguage;
        utterance.onend = () => { if (conversationActive.current && voiceEnabled.current) nextVoiceTurn.current(); };
        window.speechSynthesis.speak(utterance);
      } else throw new Error("Browser voice replies are unavailable.");
    } catch (e) {
      if (session !== replySession.current) return;
      setError(e instanceof Error ? e.message : "Could not play voice reply.");
    }
  }
  async function apiReply(message: string, language: string) {
    const res = await fetch("/api/reply", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:message.slice(0,700),language})});
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Could not translate the assistant reply.");
    return body.text as string;
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
    preparedDraft.current=true;
    setText("");
    setPreview(result);
    conversationActive.current = true;
    setAssistantReply("");
    setAck(false);
    setOverrides({});
    assistant.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const uncertain = result.actions.find((a) => a.needsClarification);
    const reply = result.blocked
      ? `${uncertain?.question || "Please clarify this instruction."} ${uncertain?.candidates?.map((c,i)=>`${i+1}: ${c.name}`).join(". ") || (uncertain?.customerName ? "Say create customer to add this person, or cancel." : "")}`
      : result.answers.length
        ? result.answers.join(" ")
        : `${result.actions.map(a=>`${a.kind}: ${a.amountPaise != null ? money(a.amountPaise) : ""} for ${a.customerName || "your shop"}`).join(". ")}. ${result.warnings.join(" ")} Say confirm to record, or cancel.`;
    if (reply) void speak(reply);
  }
  async function submitCommand(value = text) {
    if (!value.trim()) return;
    if(!navigator.onLine){
      if(preview||customerDraft){setError("Reconnect before answering or confirming this conversation. Nothing was posted.");return;}
      try{await saveOfflineDraft({kind:"text",text:value,language});setOfflineCount((await offlineDrafts()).length);setNotice("Command saved on this device. Open Shop tools → Offline drafts when connected; nothing has been posted.");setText("");}catch(e){setError(e instanceof Error?e.message:"Offline storage failed.");}return;
    }
    responseLanguage.current = inferReplyLanguage(value, responseLanguage.current);
    voiceSession.current++;
    voice.current?.stop();
    voice.current = null;
    setListening(false);
    setVoiceFinishing(false);
    voiceStopRequested.current = false;
    if (customerDraft) {
      const turn = advanceCustomer(customerDraft,value);
      setText("");
      if (turn.kind === "cancel") { setCustomerDraft(null); conversationActive.current=false; await speak("Customer creation cancelled. Nothing was saved."); return; }
      if (turn.kind === "error") { await speak(turn.message); return; }
      if (turn.kind === "save") {
        await work(async()=>{
          await api({op:"customer",name:turn.draft.name,phone:turn.draft.phone,nicknames:turn.draft.nicknames});
          setCustomerDraft(null); conversationActive.current=false; await refresh();
          await speak(`Customer ${turn.draft.name} was added. You can now record a transaction.`);
        });
      } else { setCustomerDraft(turn.draft); await speak(draftQuestion(turn.draft)); }
      return;
    }
    if (preview) {
      const followup = conversationFollowup(value, preview);
      if (followup.kind === "cancel") { await discard(); return; }
      if (followup.kind === "confirm") { await confirm(true); return; }
      if (followup.kind === "create") { await createCustomerForAction(followup.index); return; }
      if (followup.kind === "clarify") {
        await work(async () => showPreview(await api({op:"clarify",commandId:preview.id,overrides:followup.overrides})));
        return;
      }
      if (preview.blocked && preview.actions.some(a=>a.clarificationFields?.includes("customer") && a.candidates?.length)) {
        await work(async()=>{
          try { showPreview(await api({op:"answerCustomer",commandId:preview.id,text:value})); }
          catch { await speak("Please say the full customer name or their option number."); }
        });
        return;
      }
      await speak("Please answer the current clarification, say confirm, or say cancel before starting another transaction.");
      return;
    }
    if (beginsCustomerConversation(value)) {
      const draft:CustomerDraft={step:"name",name:"",phone:"",nicknames:""};
      setCustomerDraft(draft); setText(""); conversationActive.current=true;
      await speak(draftQuestion(draft)); return;
    }
    if(shopToolsOpen && /\b(took|sold|sale|bought|bag|kg)\b|बिक्री|लिया/u.test(shopCommand.toLowerCase())){
      setShopCommand(previous=>`${previous}. Clarification: ${value}`);setText("");return;
    }
    if(/\b(inventory|stock|supplier|invoice|product|item|forecast|cash.?flow|what.?if|simulate|overdue|reminder|shop memory|why.*balance|took.*(?:bag|kg|rice)|sold|sale)\b|स्टॉक|उत्पाद|सामान|ಹೊಸ\s*ಉತ್ಪನ್ನ|కొత్త\s*వస్తువు|बिल|आपूर्तिकर्ता|पूर्वानुमान|बिक्री/u.test(value.toLowerCase())){
      setShopCommand(value);setShopToolsOpen(true);setText("");return;
    }
    await work(async () => {
      const result = await api({ op: "preview", text: value });
      showPreview(result);
    });
  }
  async function startVoice() {
    if (listening) {
      if (voiceStopRequested.current) return;
      voiceStopRequested.current = true;
      setVoiceFinishing(true);
      voice.current?.stop();
      return;
    }
    if(!navigator.onLine){
      const generation=++voiceSession.current;setError("");setListening(true);setVoiceReady(true);setOfflineRecording(true);conversationActive.current=false;
      try{const handle=await recordOfflineVoice(async audio=>{await saveOfflineDraft({kind:"audio",audio,language});setOfflineCount((await offlineDrafts()).length);setNotice("Offline voice recording saved on this device. Transcribe and review it from Shop tools → Offline drafts after reconnecting.");},()=>{if(generation===voiceSession.current){setListening(false);setOfflineRecording(false);setVoiceFinishing(false);voiceStopRequested.current=false;voice.current=null;}},setError);if(generation!==voiceSession.current)handle.stop();else voice.current=handle;}
      catch(e){setListening(false);setOfflineRecording(false);setError(e instanceof Error?e.message:"Could not record offline.");}return;
    }
    const selectedLanguage = LANGUAGES.find((item) => item.code === language);
    const useServerSpeech = data?.providers.streamingVoice && recognitionMode !== "browser";
    if (language === "auto" && !useServerSpeech) {
      setError("Automatic language detection requires Sarvam speech. Choose Sarvam speech or explicitly select a language for browser speech.");
      return;
    }
    if (useServerSpeech && !data.providers.sarvamVoice && !selectedLanguage?.gnani) {
      setError(`${selectedLanguage?.name || "This language"} voice needs the Sarvam connection. You can still type your command, or choose a Gnani voice language.`);
      return;
    }
    setError("");
    voiceEnabled.…9693 tokens truncated…               placeholder="Search customer or note…"
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
              {tab !== "overview" && renderAssistant()}
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
          {data?.providers.sarvamVoice
            ? "Sarvam voice is configured for all 22 scheduled Indian languages plus English."
            : data?.providers.streamingVoice
              ? "Gnani voice covers Bengali, English, Gujarati, Hindi, Kannada, Malayalam, Marathi, Punjabi, Tamil, and Telugu. The remaining Indian languages need the Sarvam connection. You can still type a command in any listed language; interpretation depends on the configured model."
              : "Browser speech is a demo and language availability depends on your browser. Connect a speech provider for reliable server voice."}
          {" "}Provider names show configuration; account quota and real-world accuracy are checked separately. Every financial entry still needs your review.
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
