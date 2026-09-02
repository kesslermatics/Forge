import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLanguage } from '../i18n';
import {
    createChatConversation,
    deleteChatConversation,
    getChatConversation,
    listChatConversations,
    renameChatConversation,
    streamChatMessage,
} from '../api/api';
import type { ChatAgentDetail, ChatConversation, ChatMessage, ChatStreamEvent } from '../api/api';
import {
    Brain, Check, ChevronDown, Edit3, History, Loader2, MessageSquare,
    Pencil, Plus, Send, Square, Trash2, X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ConfirmDialog from './ConfirmDialog';

const SAND = '#e8c58a';
const BORDER = 'rgba(232,197,138,0.12)';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.48)';
const MUTED = 'rgba(242,236,226,0.68)';

type ToolStep = {
    key: string;
    label: string;
    done: boolean;
    call?: number;
    kind?: 'tool' | 'thinking' | 'summary';
};

export default function ChatPage() {
    const { lang } = useLanguage();
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [active, setActive] = useState<ChatConversation | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingChats, setLoadingChats] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingValue, setEditingValue] = useState('');
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [historyOpen, setHistoryOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<ChatConversation | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const rows = await listChatConversations();
                if (cancelled) return;
                setConversations(rows);
                if (rows[0]) {
                    const conversation = await getChatConversation(rows[0].id);
                    if (!cancelled) { setActive(conversation); setMessages(conversation.messages ?? []); }
                } else {
                    const conversation = await createChatConversation();
                    if (!cancelled) { setConversations([conversation]); setActive(conversation); setMessages([]); }
                }
            } catch (caught: unknown) {
                if (!cancelled) setError(caught instanceof Error ? caught.message : 'Chats konnten nicht geladen werden.');
            } finally {
                if (!cancelled) setLoadingChats(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading, toolSteps]);

    const selectConversation = async (conversation: ChatConversation) => {
        if (loading || conversation.id === active?.id) return;
        setError(null);
        try {
            const loaded = await getChatConversation(conversation.id);
            setActive(loaded); setMessages(loaded.messages ?? []); setToolSteps([]);
        } catch (caught: unknown) {
            setError(caught instanceof Error ? caught.message : 'Chat konnte nicht geladen werden.');
        }
    };

    const newConversation = async () => {
        if (loading) return;
        try {
            const conversation = await createChatConversation();
            setConversations(previous => [conversation, ...previous]);
            setActive(conversation); setMessages([]); setInput(''); setToolSteps([]); setHistoryOpen(false);
        } catch (caught: unknown) {
            setError(caught instanceof Error ? caught.message : 'Neuer Chat konnte nicht erstellt werden.');
        }
    };

    const handleStreamEvent = (event: ChatStreamEvent) => {
        if (event.type === 'tool_started' && event.tool && event.label) {
            setToolSteps(previous => [...previous, {
                key: `${event.tool}-${event.call ?? previous.length}`,
                label: event.label ?? 'Ich prüfe deine Daten.',
                done: false,
                call: event.call,
                kind: 'tool',
            }]);
        }
        if (event.type === 'thinking' && event.text) {
            setToolSteps(previous => [...previous, {
                key: `thinking-${previous.length}`,
                label: event.text ?? 'Ich ordne die Daten ein.',
                done: true,
                kind: 'thinking',
            }]);
        }
        if (event.type === 'tool_finished' && event.tool) {
            setToolSteps(previous => {
                const index = [...previous].reverse().findIndex(step => step.key.startsWith(`${event.tool}-`) && !step.done);
                if (index < 0) return previous;
                const actualIndex = previous.length - 1 - index;
                return previous.map((step, stepIndex) => stepIndex === actualIndex ? { ...step, done: true } : step);
            });
        }
        if (event.type === 'summary_started') setToolSteps(previous => [...previous, { key: 'summary', label: event.label ?? 'Ich fasse den älteren Verlauf zusammen.', done: false, kind: 'summary' }]);
        if (event.type === 'summary_finished') setToolSteps(previous => previous.map(step => step.key === 'summary' ? { ...step, done: true, label: event.label ?? step.label } : step));
        if (event.type === 'error') setError(typeof event.message === 'string' ? event.message : 'Der Coach konnte nicht antworten.');
    };

    const send = async (event?: FormEvent, editedMessageId?: string) => {
        event?.preventDefault();
        const value = (editedMessageId ? editingValue : input).trim();
        if (!value || loading || !active) return;
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true); setError(null); setToolSteps([]);
        setInput(''); setEditingId(null); setEditingValue('');
        if (!editedMessageId) setMessages(previous => [...previous, { role: 'user', content: value }]);
        try {
            await streamChatMessage(active.id, value, handleStreamEvent, controller.signal, editedMessageId);
            const loaded = await getChatConversation(active.id);
            setActive(loaded); setMessages(loaded.messages ?? []);
            setConversations(previous => previous.map(item => item.id === loaded.id ? { ...item, ...loaded } : item));
        } catch (caught: unknown) {
            if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
                setError(caught instanceof Error ? caught.message : 'Der Coach konnte nicht antworten.');
            }
            try {
                const loaded = await getChatConversation(active.id);
                setActive(loaded); setMessages(loaded.messages ?? []);
            } catch { /* preserve the visible error */ }
        } finally {
            abortRef.current = null; setLoading(false); setToolSteps([]);
        }
    };

    const stop = () => { abortRef.current?.abort(); };

    const beginEdit = (message: ChatMessage) => {
        if (!message.id || loading) return;
        setEditingId(message.id); setEditingValue(message.content);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
    };

    const saveRename = async (conversation: ChatConversation) => {
        const value = renameValue.trim();
        if (!value) { setRenamingId(null); return; }
        try {
            const renamed = await renameChatConversation(conversation.id, value);
            setConversations(previous => previous.map(item => item.id === renamed.id ? { ...item, ...renamed } : item));
            if (active?.id === renamed.id) setActive(previous => previous ? { ...previous, ...renamed } : previous);
        } catch (caught: unknown) {
            setError(caught instanceof Error ? caught.message : 'Chat konnte nicht umbenannt werden.');
        } finally { setRenamingId(null); }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        try {
            await deleteChatConversation(deleteTarget.id);
            const remaining = conversations.filter(item => item.id !== deleteTarget.id);
            setConversations(remaining);
            if (active?.id === deleteTarget.id) {
                const next = remaining[0] ?? await createChatConversation();
                setConversations(remaining.length ? remaining : [next]);
                const loaded = remaining.length ? await getChatConversation(next.id) : next;
                setActive(loaded); setMessages(loaded.messages ?? []); setToolSteps([]);
            }
        } catch (caught: unknown) {
            setError(caught instanceof Error ? caught.message : 'Chat konnte nicht gelöscht werden.');
        } finally { setDeleteTarget(null); setHistoryOpen(false); }
    };

    if (loadingChats) return <div className="h-[60vh] flex items-center justify-center"><Loader2 className="animate-spin" style={{ color: SAND }} /></div>;

    return <div className="forge-anim space-y-4 pb-3">
        <header className="flex items-start justify-between gap-3">
            <div>
                <p className="text-[10px] uppercase tracking-[0.2em]" style={{ color: SAND }}>Forge Coach</p>
                <h1 className="text-[26px] font-semibold tracking-tight mt-1" style={{ color: TEXT }}>Dein persönlicher Chat</h1>
                <p className="text-[12px] mt-1" style={{ color: DIM }}>Training, Ernährung und Fortschritt — mit deinem echten Verlauf.</p>
            </div>
            <div className="flex items-center gap-2">
                <button onClick={() => setHistoryOpen(true)} disabled={loading} className="tap flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] cursor-pointer" style={{ color: MUTED, background: 'rgba(255,247,235,0.045)', border: `1px solid ${BORDER}` }} aria-label="Chatverlauf öffnen">
                    <History size={14} /> Verlauf
                </button>
                <button onClick={() => void newConversation()} disabled={loading} className="tap flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] cursor-pointer" style={{ color: SAND, background: `${SAND}14`, border: `1px solid ${SAND}30` }}>
                    <Plus size={14} /> Neu
                </button>
            </div>
        </header>

        {error && <div role="alert" className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.18)' }}>{error}</div>}

        <section className="min-h-[72vh] flex flex-col">
            <div className="flex items-center justify-between gap-3 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ color: SAND, background: `${SAND}14`, border: `1px solid ${SAND}30` }}><MessageSquare size={17} /></div>
                    <div className="min-w-0"><h2 className="truncate text-[14px] font-medium" style={{ color: TEXT }}>{active?.title ?? 'Coach Chat'}</h2><p className="text-[10px]" style={{ color: DIM }}>Deine Daten bleiben in deinem Account.</p></div>
                </div>
                {loading && <button onClick={stop} className="tap flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] cursor-pointer" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)' }}><Square size={11} fill="currentColor" /> Stoppen</button>}
            </div>

            <div className="flex-1 overflow-y-auto py-6 space-y-4">
                {messages.length === 0 && !loading && <div className="h-full min-h-[330px] flex flex-col items-center justify-center text-center px-6 forge-anim">
                    <div className="w-16 h-16 rounded-[22px] flex items-center justify-center mb-5" style={{ color: SAND, background: `linear-gradient(145deg, ${SAND}22, ${SAND}08)`, border: `1px solid ${SAND}30`, boxShadow: `0 0 40px ${SAND}12` }}><MessageSquare size={27} /></div>
                    <h3 className="text-[18px] font-medium" style={{ color: TEXT }}>Was möchtest du wissen?</h3>
                    <p className="max-w-sm text-[12px] leading-relaxed mt-2" style={{ color: DIM }}>Ich kann deine echten Workouts, Ernährung, Ziele und Fortschritte nachschauen — statt allgemeine Antworten zu raten.</p>
                    <div className="flex flex-wrap justify-center gap-2 mt-5"><Suggestion text="Wie war mein letztes Workout?" onClick={() => setInput('Wie war mein letztes Workout?')} /><Suggestion text="Wie viel Protein hatte ich?" onClick={() => setInput('Wie viel Protein hatte ich in den letzten Tagen?')} /></div>
                </div>}
                {messages.map(message => <MessageBubble key={message.id ?? `${message.role}-${message.sequence}`} message={message} onEdit={message.role === 'user' ? beginEdit : undefined} />)}
                {loading && <div className="flex justify-start forge-anim"><div className="max-w-[92%] rounded-2xl px-4 py-3" style={{ background: 'rgba(255,247,235,0.045)', border: `1px solid ${BORDER}` }}>
                    <div className="flex items-center gap-2 text-[12px]" style={{ color: MUTED }}><Loader2 size={13} className="animate-spin" style={{ color: SAND }} /> Forge denkt mit <span className="inline-flex gap-0.5"><i className="w-1 h-1 rounded-full animate-bounce" style={{ background: SAND }} /><i className="w-1 h-1 rounded-full animate-bounce [animation-delay:120ms]" style={{ background: SAND }} /><i className="w-1 h-1 rounded-full animate-bounce [animation-delay:240ms]" style={{ background: SAND }} /></span></div>
                    {toolSteps.length > 0 && <div className="mt-3 space-y-2">{toolSteps.map(step => <div key={step.key} className="flex items-start gap-2 text-[11px] forge-anim" style={{ color: step.done ? DIM : MUTED }}><span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ color: step.done ? '#9bd3a8' : SAND, background: step.done ? 'rgba(155,211,168,0.10)' : `${SAND}12` }}>{step.kind === 'thinking' ? <Brain size={11} /> : step.done ? <Check size={11} /> : <Loader2 size={11} className="animate-spin" />}</span><span>{step.label}</span></div>)}</div>}
                </div></div>}
                <div ref={endRef} />
            </div>

            <div className="p-3 sm:p-4" style={{ borderTop: `1px solid ${BORDER}` }}>
                {editingId && <div className="flex items-center justify-between gap-2 mb-2 rounded-xl px-3 py-2 text-[11px]" style={{ color: SAND, background: `${SAND}10`, border: `1px solid ${SAND}25` }}><span className="flex items-center gap-1.5"><Edit3 size={12} /> Nachricht bearbeiten — alles danach wird neu aufgebaut.</span><button onClick={() => { setEditingId(null); setEditingValue(''); }} className="tap cursor-pointer" style={{ color: DIM }}><X size={14} /></button></div>}
                <form onSubmit={event => void send(event, editingId ?? undefined)} className="flex items-end gap-2 rounded-2xl p-2" style={{ background: 'rgba(255,247,235,0.045)', border: `1px solid ${loading ? `${SAND}22` : BORDER}` }}>
                    <textarea ref={textareaRef} value={editingId ? editingValue : input} onChange={event => editingId ? setEditingValue(event.target.value) : setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(undefined, editingId ?? undefined); } }} rows={1} disabled={loading} placeholder={editingId ? 'Korrigiere deine Nachricht…' : 'Frag Forge alles über dich…'} className="min-h-[42px] max-h-32 flex-1 resize-none bg-transparent px-2 py-2 text-[13px] outline-none" style={{ color: TEXT }} />
                    <button type="submit" disabled={loading || !(editingId ? editingValue : input).trim()} className="tap w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer disabled:opacity-30" style={{ color: SAND, background: `${SAND}18`, border: `1px solid ${SAND}30` }}>{editingId ? <Check size={16} /> : <Send size={16} />}</button>
                </form>
                <p className="text-center text-[10px] mt-2" style={{ color: 'rgba(242,236,226,0.28)' }}>{lang === 'de' ? 'Enter zum Senden · Shift + Enter für eine neue Zeile' : 'Enter to send · Shift + Enter for a new line'}</p>
            </div>
        </section>

        {historyOpen && <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Chatverlauf">
            <button className="absolute inset-0 cursor-default" style={{ background: 'rgba(8,7,5,0.72)', backdropFilter: 'blur(8px)' }} onClick={() => setHistoryOpen(false)} aria-label="Verlauf schließen" />
            <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-[26px]" style={{ background: '#211c16', border: `1px solid ${BORDER}`, boxShadow: `0 24px 80px rgba(0,0,0,0.45)` }}>
                <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ color: SAND, background: `${SAND}14`, border: `1px solid ${SAND}30` }}><History size={17} /></div><div><h2 className="text-[14px] font-medium" style={{ color: TEXT }}>Chatverlauf</h2><p className="text-[10px]" style={{ color: DIM }}>{conversations.length} gespeicherte Chats</p></div></div>
                    <button onClick={() => setHistoryOpen(false)} className="tap rounded-xl p-2 cursor-pointer" style={{ color: DIM }} aria-label="Verlauf schließen"><X size={16} /></button>
                </div>
                <div className="max-h-[62vh] overflow-y-auto p-3">
                    {conversations.length === 0 && <p className="px-3 py-8 text-center text-[12px]" style={{ color: DIM }}>Noch keine gespeicherten Chats.</p>}
                    <div className="space-y-1.5">{conversations.map(conversation => <div key={conversation.id} className="flex items-center gap-2 rounded-2xl px-2 py-2 transition-colors" style={{ background: conversation.id === active?.id ? `${SAND}10` : 'transparent', border: `1px solid ${conversation.id === active?.id ? `${SAND}28` : 'transparent'}` }}>
                        {renamingId === conversation.id
                            ? <input autoFocus value={renameValue} onChange={event => setRenameValue(event.target.value)} onBlur={() => void saveRename(conversation)} onKeyDown={event => { if (event.key === 'Enter') void saveRename(conversation); if (event.key === 'Escape') setRenamingId(null); }} className="min-w-0 flex-1 rounded-xl px-3 py-2 text-[12px] outline-none" style={{ color: TEXT, background: `${SAND}12`, border: `1px solid ${SAND}38` }} />
                            : <button onClick={() => { void selectConversation(conversation).then(() => setHistoryOpen(false)); }} disabled={loading} className="tap min-w-0 flex-1 text-left rounded-xl px-2 py-1.5 cursor-pointer disabled:opacity-50">
                                <span className="flex items-center gap-2"><span className="block truncate text-[12px] font-medium" style={{ color: conversation.id === active?.id ? TEXT : MUTED }}>{conversation.title}</span>{conversation.id === active?.id && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px]" style={{ color: SAND, background: `${SAND}18` }}>Aktiv</span>}</span>
                                <span className="block mt-0.5 text-[10px]" style={{ color: DIM }}>{conversation.message_count ? `${conversation.message_count} Nachrichten` : 'Leer'}{conversation.updated_at ? ` · ${formatChatDate(conversation.updated_at)}` : ''}</span>
                            </button>}
                        {renamingId !== conversation.id && <div className="flex shrink-0 items-center gap-0.5"><button onClick={() => { setRenamingId(conversation.id); setRenameValue(conversation.title); }} disabled={loading} className="tap rounded-lg p-2 cursor-pointer disabled:opacity-40" style={{ color: DIM }} aria-label="Chat umbenennen"><Pencil size={13} /></button><button onClick={() => setDeleteTarget(conversation)} disabled={loading} className="tap rounded-lg p-2 cursor-pointer disabled:opacity-40" style={{ color: '#fca5a5' }} aria-label="Chat löschen"><Trash2 size={13} /></button></div>}
                    </div>)}</div>
                </div>
            </div>
        </div>}
        <ConfirmDialog open={deleteTarget !== null} title="Chat löschen?" description="Der gesamte Verlauf dieses Chats wird dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden." confirmLabel="Chat löschen" destructive onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />
    </div >;
}

function formatChatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(date);
}

function MessageBubble({ message, onEdit }: { message: ChatMessage; onEdit?: (message: ChatMessage) => void }) {
    const user = message.role === 'user';
    return <div className={`group flex ${user ? 'justify-end' : 'justify-start'} forge-anim`}>
        <div className={`relative max-w-[94%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${user ? 'rounded-br-md' : 'rounded-bl-md'}`} style={user ? { color: TEXT, background: `${SAND}18`, border: `1px solid ${SAND}30` } : { color: '#e8dcc8', background: 'rgba(255,247,235,0.05)', border: `1px solid ${BORDER}` }}>
            {user
                ? <div className="whitespace-pre-wrap">{message.content}</div>
                : <>
                    <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_strong]:text-[#e8c58a] [&_ul]:my-1 [&_li]:my-0.5 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-[#e8c58a33] [&_th]:bg-[#e8c58a12] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:border-[#e8c58a22] [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_tr]:border-b [&_tr]:border-[#e8c58a18] [&_code]:break-words"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>
                    <AgentDetails details={message.agent_details ?? []} />
                </>}
            {user && onEdit && <button onClick={() => onEdit(message)} className="absolute -left-8 top-1/2 -translate-y-1/2 hidden group-hover:flex tap p-1.5 rounded-lg cursor-pointer" style={{ color: DIM, background: 'rgba(255,247,235,0.06)' }} aria-label="Nachricht bearbeiten"><Edit3 size={12} /></button>}
        </div>
    </div>;
}

function AgentDetails({ details }: { details: ChatAgentDetail[] }) {
    if (!details.length) return null;
    return <details className="mt-3 rounded-xl overflow-hidden" style={{ background: 'rgba(232,197,138,0.045)', border: `1px solid ${BORDER}` }}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: DIM }}>
            <Brain size={13} style={{ color: SAND }} />
            <span className="flex-1">Recherche &amp; Gedanken-Zusammenfassung</span>
            <span className="normal-case tracking-normal">{details.length} Schritte</span>
            <ChevronDown size={14} className="transition-transform details-open:rotate-180" />
        </summary>
        <div className="space-y-2 px-3 pb-3">
            {details.map((detail, index) => <div key={`${detail.type}-${detail.call ?? index}-${index}`} className="flex items-start gap-2 rounded-lg px-2.5 py-2 text-[11px]" style={{ color: MUTED, background: 'rgba(255,247,235,0.035)' }}>
                <span className="mt-0.5 shrink-0" style={{ color: detail.type === 'thinking' ? SAND : '#9bd3a8' }}>{detail.type === 'thinking' ? <Brain size={12} /> : <Check size={12} />}</span>
                <span>{detail.type === 'tool' ? detail.label : detail.text ?? detail.label}</span>
            </div>)}
        </div>
    </details>;
}

function Suggestion({ text, onClick }: { text: string; onClick: () => void }) {
    return <button onClick={onClick} className="tap rounded-xl px-3 py-2 text-[11px] cursor-pointer" style={{ color: MUTED, background: 'rgba(255,247,235,0.04)', border: `1px solid ${BORDER}` }}>{text}</button>;
}
