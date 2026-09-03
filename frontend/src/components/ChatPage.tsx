import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLanguage } from '../i18n';
import { createChatConversation, streamChatMessage } from '../api/api';
import type { ChatAgentDetail, ChatConversation, ChatMessage, ChatStreamEvent } from '../api/api';
import { Brain, Check, ChevronDown, Edit3, Loader2, MessageSquare, Send, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
    const [active, setActive] = useState<ChatConversation | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingValue, setEditingValue] = useState('');
    const abortRef = useRef<AbortController | null>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        let cancelled = false;
        const startFreshChat = async () => {
            try {
                const conversation = await createChatConversation();
                if (cancelled) return;
                setActive(conversation);
                setMessages([]);
                setToolSteps([]);
            } catch (caught: unknown) {
                if (!cancelled) setError(caught instanceof Error ? caught.message : 'Neuer Chat konnte nicht erstellt werden.');
            } finally {
                if (!cancelled) setInitializing(false);
            }
        };
        void startFreshChat();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading, toolSteps]);

    const handleStreamEvent = (event: ChatStreamEvent) => {
        if (event.type === 'tool_started' && event.tool && event.label) {
            const { tool, label, call } = event;
            setToolSteps(previous => [...previous, {
                key: `${tool}-${call ?? previous.length}`,
                label,
                done: false,
                call,
                kind: 'tool',
            }]);
        }
        if (event.type === 'thinking' && event.text) {
            const text = event.text;
            setToolSteps(previous => [...previous, {
                key: `thinking-${previous.length}`,
                label: text,
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
        if (event.type === 'summary_started') setToolSteps(previous => [...previous, { key: 'summary', label: event.label ?? 'Ich ordne die bisherigen Nachrichten ein.', done: false, kind: 'summary' }]);
        if (event.type === 'summary_finished') setToolSteps(previous => previous.map(step => step.key === 'summary' ? { ...step, done: true, label: event.label ?? step.label } : step));
        if (event.type === 'completed') {
            const assistantMessage = event.message;
            if (assistantMessage && typeof assistantMessage !== 'string') {
                setMessages(previous => [...previous, assistantMessage]);
            }
            if (event.conversation) setActive(event.conversation);
        }
        if (event.type === 'error') {
            setError(typeof event.message === 'string' ? event.message : 'Der Coach konnte nicht antworten.');
        }
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
        } catch (caught: unknown) {
            if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
                setError(caught instanceof Error ? caught.message : 'Der Coach konnte nicht antworten.');
            }
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

    if (initializing) return <div className="h-[60vh] flex items-center justify-center"><Loader2 className="animate-spin" style={{ color: SAND }} /></div>;

    return <div className="forge-anim flex h-[calc(100dvh-10rem)] min-h-0 flex-col gap-4 overflow-hidden">
        <header className="shrink-0">
            <p className="text-[10px] uppercase tracking-[0.2em]" style={{ color: SAND }}>Forge Coach</p>
            <h1 className="text-[26px] font-semibold tracking-tight mt-1" style={{ color: TEXT }}>Dein persönlicher Chat</h1>
            <p className="text-[12px] mt-1" style={{ color: DIM }}>Training, Ernährung und Fortschritt — mit deinen aktuellen Daten.</p>
        </header>

        {error && <div role="alert" className="shrink-0 rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.18)' }}>{error}</div>}

        <section className="min-h-0 flex-1 flex flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-3 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ color: SAND, background: `${SAND}14`, border: `1px solid ${SAND}30` }}><MessageSquare size={17} /></div>
                    <div className="min-w-0"><h2 className="truncate text-[14px] font-medium" style={{ color: TEXT }}>Coach Chat</h2><p className="text-[10px]" style={{ color: DIM }}>Dieses Gespräch beginnt bei jedem Start neu.</p></div>
                </div>
                {loading && <button onClick={stop} className="tap flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] cursor-pointer" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)' }}><Square size={11} fill="currentColor" /> Stoppen</button>}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-6 space-y-4" style={{ scrollbarGutter: 'stable' }}>
                {messages.length === 0 && !loading && <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center px-6 forge-anim">
                    <div className="w-16 h-16 rounded-[22px] flex items-center justify-center mb-5" style={{ color: SAND, background: `linear-gradient(145deg, ${SAND}22, ${SAND}08)`, border: `1px solid ${SAND}30`, boxShadow: `0 0 40px ${SAND}12` }}><MessageSquare size={27} /></div>
                    <h3 className="text-[18px] font-medium" style={{ color: TEXT }}>Was möchtest du wissen?</h3>
                    <p className="max-w-sm text-[12px] leading-relaxed mt-2" style={{ color: DIM }}>Ich kann deine echten Workouts, Ernährung, Ziele und Fortschritte nachschauen — statt allgemeine Antworten zu raten.</p>
                    <div className="flex flex-wrap justify-center gap-2 mt-5"><Suggestion text="Wie war mein letztes Workout?" onClick={() => setInput('Wie war mein letztes Workout?')} /><Suggestion text="Wie viel Protein hatte ich?" onClick={() => setInput('Wie viel Protein hatte ich in den letzten Tagen?')} /></div>
                </div>}
                {messages.map((message, index) => <MessageBubble key={message.id ?? `${message.role}-${message.sequence ?? index}`} message={message} onEdit={message.role === 'user' ? beginEdit : undefined} />)}
                {loading && <div className="flex justify-start forge-anim"><div className="max-w-[92%] rounded-2xl px-4 py-3" style={{ background: 'rgba(255,247,235,0.045)', border: `1px solid ${BORDER}` }}>
                    <div className="flex items-center gap-2 text-[12px]" style={{ color: MUTED }}><Loader2 size={13} className="animate-spin" style={{ color: SAND }} /> Forge denkt mit <span className="inline-flex gap-0.5"><i className="w-1 h-1 rounded-full animate-bounce" style={{ background: SAND }} /><i className="w-1 h-1 rounded-full animate-bounce [animation-delay:120ms]" style={{ background: SAND }} /><i className="w-1 h-1 rounded-full animate-bounce [animation-delay:240ms]" style={{ background: SAND }} /></span></div>
                    {toolSteps.length > 0 && <div className="mt-3 space-y-2">{toolSteps.map(step => <div key={step.key} className="flex items-start gap-2 text-[11px] forge-anim" style={{ color: step.done ? DIM : MUTED }}><span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ color: step.done ? '#9bd3a8' : SAND, background: step.done ? 'rgba(155,211,168,0.10)' : `${SAND}12` }}>{step.kind === 'thinking' ? <Brain size={11} /> : step.done ? <Check size={11} /> : <Loader2 size={11} className="animate-spin" />}</span><div className="min-w-0 flex-1">{step.kind === 'thinking' || step.kind === 'summary' ? <FormattedMarkdown content={step.label} compact /> : <span>{step.label}</span>}</div></div>)}</div>}
                </div></div>}
                <div ref={endRef} />
            </div>

            <div className="shrink-0 border-t pt-3" style={{ borderColor: BORDER }}>
                {editingId && <div className="flex items-center justify-between gap-2 mb-2 rounded-xl px-3 py-2 text-[11px]" style={{ color: SAND, background: `${SAND}10`, border: `1px solid ${SAND}25` }}><span className="flex items-center gap-1.5"><Edit3 size={12} /> Nachricht bearbeiten — alles danach wird neu aufgebaut.</span><button onClick={() => { setEditingId(null); setEditingValue(''); }} className="tap cursor-pointer" style={{ color: DIM }}><X size={14} /></button></div>}
                <form onSubmit={event => void send(event, editingId ?? undefined)} className="flex items-end gap-2 rounded-2xl p-2" style={{ background: 'rgba(255,247,235,0.045)', border: `1px solid ${loading ? `${SAND}22` : BORDER}` }}>
                    <textarea ref={textareaRef} value={editingId ? editingValue : input} onChange={event => editingId ? setEditingValue(event.target.value) : setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(undefined, editingId ?? undefined); } }} rows={1} disabled={loading} placeholder={editingId ? 'Korrigiere deine Nachricht…' : 'Frag Forge alles über dich…'} className="min-h-[42px] max-h-32 flex-1 resize-none bg-transparent px-2 py-2 text-[13px] outline-none" style={{ color: TEXT }} />
                    <button type="submit" disabled={loading || !(editingId ? editingValue : input).trim()} className="tap w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer disabled:opacity-30" style={{ color: SAND, background: `${SAND}18`, border: `1px solid ${SAND}30` }}>{editingId ? <Check size={16} /> : <Send size={16} />}</button>
                </form>
                <p className="text-center text-[10px] mt-2" style={{ color: 'rgba(242,236,226,0.28)' }}>{lang === 'de' ? 'Enter zum Senden · Shift + Enter für eine neue Zeile' : 'Enter to send · Shift + Enter for a new line'}</p>
            </div>
        </section>
    </div>;
}

function MessageBubble({ message, onEdit }: { message: ChatMessage; onEdit?: (message: ChatMessage) => void }) {
    const user = message.role === 'user';
    return <div className={`group flex ${user ? 'justify-end' : 'justify-start'} forge-anim`}>
        <div className={`relative max-w-[94%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${user ? 'rounded-br-md' : 'rounded-bl-md'}`} style={user ? { color: TEXT, background: `${SAND}18`, border: `1px solid ${SAND}30` } : { color: '#e8dcc8', background: 'rgba(255,247,235,0.05)', border: `1px solid ${BORDER}` }}>
            {user
                ? <div className="whitespace-pre-wrap">{message.content}</div>
                : <><FormattedMarkdown content={message.content} /><AgentDetails details={message.agent_details ?? []} /></>}
            {user && onEdit && <button onClick={() => onEdit(message)} className="absolute -left-8 top-1/2 -translate-y-1/2 hidden group-hover:flex tap p-1.5 rounded-lg cursor-pointer" style={{ color: DIM, background: 'rgba(255,247,235,0.06)' }} aria-label="Nachricht bearbeiten"><Edit3 size={12} /></button>}
        </div>
    </div>;
}

function FormattedMarkdown({ content, compact = false }: { content: string; compact?: boolean }) {
    const className = compact
        ? 'text-[11px] leading-relaxed [&_p]:my-0.5 [&_strong]:text-[#e8c58a] [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_hr]:my-3 [&_hr]:border-t [&_hr]:border-[#e8c58a55] [&_hr]:opacity-80 [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:mt-2 [&_h3]:mb-1 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-[#e8c58a33] [&_th]:bg-[#e8c58a12] [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:border-[#e8c58a22] [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_code]:break-words'
        : 'prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_strong]:text-[#e8c58a] [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_hr]:my-4 [&_hr]:border-t [&_hr]:border-[#e8c58a55] [&_hr]:opacity-80 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-[#e8c58a33] [&_th]:bg-[#e8c58a12] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:border-[#e8c58a22] [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_tr]:border-b [&_tr]:border-[#e8c58a18] [&_code]:break-words';
    return <div className={className}><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>;
}

function AgentDetails({ details }: { details: ChatAgentDetail[] }) {
    if (!details.length) return null;
    return <details className="mt-3 rounded-xl overflow-hidden" style={{ background: 'rgba(232,197,138,0.045)', border: `1px solid ${BORDER}` }}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: DIM }}>
            <Brain size={13} style={{ color: SAND }} /><span className="flex-1">Recherche &amp; Gedanken-Zusammenfassung</span><span className="normal-case tracking-normal">{details.length} Schritte</span><ChevronDown size={14} className="transition-transform details-open:rotate-180" />
        </summary>
        <div className="space-y-2 px-3 pb-3">
            {details.map((detail, index) => <div key={`${detail.type}-${detail.call ?? index}-${index}`} className="flex items-start gap-2 rounded-lg px-2.5 py-2 text-[11px]" style={{ color: MUTED, background: 'rgba(255,247,235,0.035)' }}>
                <span className="mt-0.5 shrink-0" style={{ color: detail.type === 'thinking' ? SAND : '#9bd3a8' }}>{detail.type === 'thinking' ? <Brain size={12} /> : <Check size={12} />}</span><div className="min-w-0 flex-1">{detail.type === 'tool' ? <span>{detail.label}</span> : <FormattedMarkdown content={detail.text ?? detail.label ?? ''} compact />}</div>
            </div>)}
        </div>
    </details>;
}

function Suggestion({ text, onClick }: { text: string; onClick: () => void }) {
    return <button onClick={onClick} className="tap rounded-xl px-3 py-2 text-[11px] cursor-pointer" style={{ color: MUTED, background: 'rgba(255,247,235,0.04)', border: `1px solid ${BORDER}` }}>{text}</button>;
}
