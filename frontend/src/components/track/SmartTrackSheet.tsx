import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Pencil, RotateCcw, Search, Sparkles, X } from 'lucide-react';
import ForgeSheet from '../ForgeSheet';
import {
    createTrackEntry, deleteTrackEntry, streamSmartTrack,
    type SmartTrackEvent, type SmartTrackItem, type SmartTrackOption, type TrackEntry,
} from '../../api/api';
import { haptic } from '../navigation';
import { BORDER, DIM, FAINT, SAND, TEXT, fmt, fmtAmount } from './trackUtils';

interface Props {
    date: string;
    slotId: string | null;
    onTracked: (entry: TrackEntry) => void;
    onRemoved: (entryId: string) => void;
    /** Close the sheet and search for this item by hand. */
    onSearch: (query: string) => void;
    onClose: () => void;
}

type CardState = 'pending' | 'tracked' | 'ambiguous' | 'not_found' | 'error' | 'removed';
interface Card {
    item: SmartTrackItem;
    state: CardState;
    entry: TrackEntry | null;
    alternatives: SmartTrackOption[];
    /** Alternatives are open for an already tracked item ("Ändern"). */
    changing: boolean;
    busy: boolean;
    /** Plays the highlight once, right after the item was tracked. */
    fresh: boolean;
}

type Phase = 'input' | 'running' | 'done';

const REVEAL_MS = 520;
const PLACEHOLDER = 'z. B. 100 g Hähnchen von Lidl, 200 g Kartoffeln und bisschen Öl';
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const errorText = (caught: unknown, fallback: string) => caught instanceof Error ? caught.message : fallback;

/** Free-text tracking: the text is split into foods, each one is found and tracked, one after another. */
export default function SmartTrackSheet({ date, slotId, onTracked, onRemoved, onSearch, onClose }: Props) {
    const [phase, setPhase] = useState<Phase>('input');
    const [text, setText] = useState('');
    const [cards, setCards] = useState<Card[]>([]);
    const [error, setError] = useState<string | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const queueRef = useRef<SmartTrackEvent[]>([]);
    const pumpingRef = useRef(false);
    const closedRef = useRef(false);
    const parsedRef = useRef(false);
    // Parent callbacks change identity on every render; refs keep the running stream intact.
    const onTrackedRef = useRef(onTracked);
    useEffect(() => { onTrackedRef.current = onTracked; }, [onTracked]);

    useEffect(() => () => { closedRef.current = true; controllerRef.current?.abort(); }, []);

    const patch = (index: number, changes: Partial<Card>) =>
        setCards((current) => current.map((card, position) => position === index ? { ...card, ...changes } : card));

    const apply = (event: SmartTrackEvent) => {
        if (event.type === 'parsed') {
            parsedRef.current = true;
            setCards(event.items.map((item) => ({ item, state: 'pending', entry: null, alternatives: [], changing: false, busy: false, fresh: false })));
        } else if (event.type === 'item') {
            patch(event.index, { state: event.status, entry: event.entry, alternatives: event.alternatives, fresh: event.status === 'tracked' });
            if (event.entry) onTrackedRef.current(event.entry);
            haptic(event.status === 'tracked' ? 'success' : 'warning');
        } else if (event.type === 'done') {
            setPhase('done');
        } else {
            setError(event.message);
            setPhase(parsedRef.current ? 'done' : 'input');
        }
    };

    // Results may arrive faster than they can be read; reveal them one by one.
    const pump = async () => {
        if (pumpingRef.current) return;
        pumpingRef.current = true;
        while (queueRef.current.length && !closedRef.current) {
            const event = queueRef.current.shift()!;
            apply(event);
            if (event.type === 'item') await sleep(REVEAL_MS);
        }
        pumpingRef.current = false;
    };

    const start = async () => {
        const value = text.trim();
        if (value.length < 2 || phase === 'running') return;
        const controller = new AbortController();
        controllerRef.current = controller;
        queueRef.current = [];
        parsedRef.current = false;
        setCards([]); setError(null); setPhase('running');
        haptic('tap');
        try {
            await streamSmartTrack({ text: value, date, slot_id: slotId }, (event) => { queueRef.current.push(event); void pump(); }, controller.signal);
        } catch (caught: unknown) {
            if (controller.signal.aborted) return;
            setError(errorText(caught, 'Tracken fehlgeschlagen.'));
            queueRef.current = [];
            setCards((current) => current.map((card) => card.state === 'pending' ? { ...card, state: 'error' } : card));
            setPhase(parsedRef.current ? 'done' : 'input');
        }
    };

    const choose = async (index: number, option: SmartTrackOption) => {
        const card = cards[index];
        if (!card || card.busy) return;
        patch(index, { busy: true });
        try {
            const entry = await createTrackEntry({ date, slot_id: slotId, source: option.source, source_id: option.source_id, amount: card.item.amount });
            onTracked(entry);
            if (card.entry) {
                await deleteTrackEntry(card.entry.id).catch(() => undefined);
                onRemoved(card.entry.id);
            }
            haptic('success');
            patch(index, { state: 'tracked', entry, changing: false, busy: false, fresh: true });
        } catch (caught: unknown) {
            haptic('warning');
            setError(errorText(caught, 'Tracken fehlgeschlagen.'));
            patch(index, { busy: false });
        }
    };

    const remove = async (index: number) => {
        const card = cards[index];
        if (!card?.entry || card.busy) return;
        patch(index, { busy: true });
        try {
            await deleteTrackEntry(card.entry.id);
            onRemoved(card.entry.id);
            haptic('tap');
            patch(index, { state: 'removed', entry: null, changing: false, busy: false });
        } catch (caught: unknown) {
            setError(errorText(caught, 'Löschen fehlgeschlagen.'));
            patch(index, { busy: false });
        }
    };

    const undoAll = async () => {
        const tracked = cards.filter((card) => card.entry);
        if (!tracked.length) return;
        haptic('tap');
        setCards((current) => current.map((card) => card.entry ? { ...card, busy: true } : card));
        const results = await Promise.allSettled(tracked.map((card) => deleteTrackEntry(card.entry!.id)));
        const removed = new Set<string>();
        results.forEach((result, position) => { if (result.status === 'fulfilled') removed.add(tracked[position].entry!.id); });
        removed.forEach(onRemoved);
        setCards((current) => current.map((card) => card.entry && removed.has(card.entry.id)
            ? { ...card, state: 'removed', entry: null, changing: false, busy: false }
            : { ...card, busy: false }));
        if (removed.size < tracked.length) setError('Einige Einträge konnten nicht entfernt werden.');
    };

    const activeIndex = cards.findIndex((card) => card.state === 'pending');
    const trackedCards = cards.filter((card) => card.entry);
    const totalKcal = trackedCards.reduce((sum, card) => sum + (card.entry?.kcal ?? 0), 0);

    const alternativeList = (index: number, card: Card) => <ul className="forge-expand mt-2 space-y-1">
        {card.alternatives.filter((option) => !(card.entry && option.source === card.entry.source && option.source_id === card.entry.source_id)).map((option) =>
            <li key={`${option.source}:${option.source_id}`}>
                <button type="button" disabled={card.busy} onClick={() => void choose(index, option)}
                    className="tap flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left disabled:opacity-50"
                    style={{ background: 'rgba(255,247,235,0.04)', border: `1px solid ${BORDER}` }}>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium" style={{ color: TEXT }}>{option.name}</span>
                        <span className="block truncate text-[11px]" style={{ color: DIM }}>
                            {[option.brand, `${fmt(option.kcal)} kcal`, option.protein != null ? `${fmt(option.protein)} g Protein` : null].filter(Boolean).join(' · ')}
                            <span style={{ color: FAINT }}> / 100 {option.unit}</span>
                        </span>
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold tabular-nums" style={{ color: SAND }}>{fmtAmount(card.item.amount)} {card.item.unit}</span>
                </button>
            </li>)}
    </ul>;

    const marker = (card: Card, index: number) => {
        const base = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold';
        if (card.state === 'tracked') return <span key="tracked" className={`${base} track-add-pop`} style={{ color: '#16130f', background: SAND }}><Check size={17} /></span>;
        if (card.state === 'pending') return <span className={base} style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>
            {index === activeIndex ? <Loader2 size={16} className="animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full" style={{ background: FAINT }} />}
        </span>;
        if (card.state === 'ambiguous') return <span className={base} style={{ color: SAND, background: 'rgba(232,197,138,0.14)' }}>?</span>;
        if (card.state === 'removed') return <span className={base} style={{ color: FAINT, background: 'rgba(255,247,235,0.05)' }}><X size={15} /></span>;
        return <span className={base} style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.12)' }}>!</span>;
    };

    const cardView = (card: Card, index: number) => {
        const { item, entry } = card;
        const title = entry ? entry.name : item.name;
        const brand = entry ? entry.brand : item.brand;
        const amount = entry ? entry.amount : item.amount;
        const unit = entry ? entry.unit : item.unit;
        const waiting = card.state === 'pending' && index !== activeIndex;
        return <li key={index} className={`forge-msg-in rounded-2xl p-3 ${card.fresh ? 'track-row-flash' : ''}`}
            style={{ background: 'rgba(255,247,235,0.035)', border: `1px solid ${BORDER}`, opacity: waiting || card.state === 'removed' ? 0.55 : 1, transition: 'opacity 0.3s' }}>
            <div className="flex items-center gap-3">
                {marker(card, index)}
                <div className="min-w-0 flex-1">
                    <p className={`truncate text-[14px] font-medium ${card.state === 'removed' ? 'line-through' : ''}`} style={{ color: TEXT }}>{title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px]" style={{ color: DIM }}>
                        <span>{fmtAmount(amount)} {unit}{brand ? ` · ${brand}` : ''}</span>
                        {item.estimated && card.state !== 'removed' && <span className="rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>geschätzt</span>}
                        {entry && <span>· {fmt(entry.protein)} g P</span>}
                        {card.state === 'pending' && index === activeIndex && <span style={{ color: SAND }}>· suche…</span>}
                        {card.state === 'ambiguous' && <span style={{ color: SAND }}>· welches meinst du?</span>}
                        {card.state === 'not_found' && <span>· nichts gefunden</span>}
                        {card.state === 'error' && <span style={{ color: '#fca5a5' }}>· fehlgeschlagen</span>}
                        {card.state === 'removed' && <span>· entfernt</span>}
                    </p>
                </div>
                {entry && <span key={entry.id} className="track-number shrink-0 text-[14px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(entry.kcal)}<span className="ml-0.5 text-[10px] font-normal" style={{ color: DIM }}>kcal</span></span>}
                {entry && <div className="flex shrink-0 items-center">
                    {card.alternatives.length > 1 && <button type="button" onClick={() => patch(index, { changing: !card.changing })} disabled={card.busy} aria-label={`${title} ändern`} aria-expanded={card.changing}
                        className="tap flex h-9 w-9 items-center justify-center rounded-full" style={{ color: card.changing ? SAND : DIM }}><Pencil size={14} /></button>}
                    <button type="button" onClick={() => void remove(index)} disabled={card.busy} aria-label={`${title} entfernen`}
                        className="tap flex h-9 w-9 items-center justify-center rounded-full" style={{ color: DIM }}>{card.busy ? <Loader2 size={14} className="animate-spin" /> : <X size={15} />}</button>
                </div>}
            </div>
            {card.state === 'ambiguous' && card.alternatives.length > 0 && alternativeList(index, card)}
            {card.state === 'tracked' && card.changing && alternativeList(index, card)}
            {(card.state === 'ambiguous' || card.state === 'not_found' || card.state === 'error') && <button type="button" onClick={() => { onSearch(item.name); onClose(); }}
                className="tap mt-2 flex h-10 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><Search size={14} />Selbst suchen</button>}
        </li>;
    };

    const running = phase === 'running';
    return <ForgeSheet label="Mit Text tracken" onClose={onClose}>
        <div className="p-1">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-[18px] font-semibold leading-snug" style={{ color: TEXT }}><Sparkles size={17} style={{ color: SAND }} />Mit Text tracken</h2>
                    <p className="mt-0.5 text-[12px]" style={{ color: DIM }}>Schreib, was du gegessen hast. Mengen darfst du schätzen lassen.</p>
                </div>
                <button type="button" onClick={onClose} aria-label="Schließen" className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><X size={18} /></button>
            </div>

            {phase === 'input' && <div className="mt-4">
                <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} autoFocus placeholder={PLACEHOLDER} aria-label="Was hast du gegessen?"
                    onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void start(); } }}
                    className="w-full resize-none rounded-2xl p-3.5 text-[16px] leading-snug outline-none"
                    style={{ color: TEXT, background: 'rgba(255,247,235,0.05)', border: `1px solid ${text ? `${SAND}66` : BORDER}`, transition: 'border-color 0.2s' }} />
                {error && <p className="mt-3 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}
                <button type="button" onClick={() => void start()} disabled={text.trim().length < 2} className="btn-forge mt-3 h-12 w-full text-[14px]"><Sparkles size={16} />Tracken</button>
            </div>}

            {phase !== 'input' && <>
                <div className="mt-4 flex items-baseline justify-between px-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: DIM }}>{running && cards.length === 0 ? 'Ich lese deinen Text…' : running ? 'Wird getrackt' : 'Fertig'}</p>
                    {trackedCards.length > 0 && <p key={Math.round(totalKcal)} className="track-number text-[20px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(totalKcal)}<span className="ml-1 text-[11px] font-normal" style={{ color: DIM }}>kcal</span></p>}
                </div>
                {running && cards.length === 0 && <div className="mt-2 space-y-2">{[0, 1, 2].map((item) => <div key={item} className="forge-skeleton h-[62px] rounded-2xl" />)}</div>}
                <ul className="mt-2 space-y-2">{cards.map(cardView)}</ul>
                {error && <p className="mt-3 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}
                {phase === 'done' && <div className="forge-msg-in mt-4 flex gap-2">
                    {trackedCards.length > 0 && <button type="button" onClick={() => void undoAll()} className="tap flex h-12 items-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold" style={{ color: '#fca5a5', border: '1px solid rgba(248,113,113,0.3)' }}><RotateCcw size={15} />Alles rückgängig</button>}
                    <button type="button" onClick={onClose} className="btn-forge h-12 flex-1 text-[14px]">Fertig</button>
                </div>}
            </>}
        </div>
    </ForgeSheet>;
}
