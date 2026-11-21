import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Check, ChevronDown, ImagePlus, Loader2, Plus, RotateCcw, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import ForgeSheet from '../ForgeSheet';
import {
    createTrackEntry, deleteTrackEntry, getSmartTrackSettings, streamSmartTrack, updateSmartTrackSettings, updateTrackEntry,
    type SmartTrackEvent, type SmartTrackItem, type SmartTrackOption, type SmartTrackSettings, type TrackEntry,
} from '../../api/api';
import { haptic } from '../navigation';
import AmountInput from './AmountInput';
import { BORDER, DIM, FAINT, SAND, TEXT, fmt, fmtAmount, parseAmount, photoToDataUrl, toAmountInput } from './trackUtils';

interface Props {
    date: string;
    slotId: string | null;
    /** JPEG data URL of a meal photo: the sheet shows it with a field for extra context before the analysis. */
    photo?: string;
    onTracked: (entry: TrackEntry) => void;
    /** An entry tracked here got a new amount. */
    onUpdated: (entry: TrackEntry) => void;
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
    /** The first alternative is the model's pick. */
    suggested: boolean;
    /** Amount to track (before tracking; afterwards the entry's amount counts). */
    amount: number | null;
    estimated: boolean;
    /** Where the amount comes from ("1 Packung", "wie zuletzt"). */
    note: string | null;
    /** The user set the amount; changing the product keeps it. */
    amountEdited: boolean;
    /** Alternatives are open for an already tracked item ("Ändern"). */
    changing: boolean;
    /** The amount editor is open; `draft` is its text. */
    editing: boolean;
    draft: string;
    busy: boolean;
    /** Plays the highlight once, right after the item was tracked. */
    fresh: boolean;
}

type Phase = 'input' | 'running' | 'done';

const REVEAL_MS = 520;
const PLACEHOLDER = 'z. B. eine Mozzarella, 200 g Tomaten, halbe Dose Mais und eine Butterbrezel';
const PHOTO_PLACEHOLDER = 'Optional: was das Foto nicht zeigt, z. B. „mit 1 EL Öl gebraten, Reis waren 250 g, Cola Zero“';
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const errorText = (caught: unknown, fallback: string) => caught instanceof Error ? caught.message : fallback;
const sameFood = (a: { source: string; source_id: string }, b: { source: string; source_id: string }) => a.source === b.source && a.source_id === b.source_id;
const kcalFor = (option: SmartTrackOption, amount: number) => option.kcal == null ? null : option.kcal * amount / 100;

const WEIGH_LABEL: Record<SmartTrackSettings['weigh_state'], string> = { raw: 'Roh gewogen', cooked: 'Gekocht gewogen' };

function pendingAmount(item: SmartTrackItem): string {
    if (item.portion && item.count) {
        const word = item.portion === 'packung' ? (item.count > 1 ? 'Packungen' : 'Packung') : (item.count > 1 ? 'Portionen' : 'Portion');
        return `${item.count === 0.5 ? '½' : fmtAmount(item.count)} ${word}`;
    }
    return item.amount == null ? '' : `${fmtAmount(item.amount)} ${item.unit}`;
}

/** Free-text or photo tracking: the input is split into foods, each one is found and tracked, one after another. */
export default function SmartTrackSheet({ photo, date, slotId, onTracked, onUpdated, onRemoved, onSearch, onClose }: Props) {
    const photoMode = Boolean(photo);
    const [image, setImage] = useState<string | null>(photo ?? null);
    const [phase, setPhase] = useState<Phase>('input');
    const [text, setText] = useState('');
    const [cards, setCards] = useState<Card[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [settings, setSettings] = useState<SmartTrackSettings | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const settingsSave = useRef<Promise<unknown> | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const queueRef = useRef<SmartTrackEvent[]>([]);
    const pumpingRef = useRef(false);
    const closedRef = useRef(false);
    const parsedRef = useRef(false);
    const textRef = useRef<HTMLTextAreaElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    // Parent callbacks change identity on every render; refs keep the running stream intact.
    const onTrackedRef = useRef(onTracked);
    useEffect(() => { onTrackedRef.current = onTracked; }, [onTracked]);

    // The cleanup also runs once in StrictMode, so the flag is reset on every mount.
    useEffect(() => {
        closedRef.current = false;
        return () => {
            closedRef.current = true;
            controllerRef.current?.abort();
            // Items still waiting for their reveal are already stored: hand them to the page right away.
            for (const event of queueRef.current.splice(0)) {
                if (event.type === 'item' && event.entry) onTrackedRef.current(event.entry);
            }
        };
    }, []);

    useEffect(() => {
        let active = true;
        getSmartTrackSettings().then((value) => { if (active) setSettings(value); }).catch(() => { if (active) setSettings({ weigh_state: 'raw' }); });
        return () => { active = false; };
    }, []);

    const changeSettings = (next: SmartTrackSettings) => {
        const previous = settings;
        haptic('tap');
        setSettings(next);
        const save = updateSmartTrackSettings(next).catch((caught: unknown) => {
            setSettings(previous);
            setError(errorText(caught, 'Einstellung konnte nicht gespeichert werden.'));
        });
        settingsSave.current = save;
    };

    const patch = (index: number, changes: Partial<Card>) =>
        setCards((current) => current.map((card, position) => position === index ? { ...card, ...changes } : card));

    const apply = (event: SmartTrackEvent) => {
        if (event.type === 'parsed') {
            parsedRef.current = true;
            setCards(event.items.map((item) => ({
                item, state: 'pending', entry: null, alternatives: [], suggested: false, amount: item.amount, estimated: item.estimated, note: null,
                amountEdited: false, changing: false, editing: false, draft: '', busy: false, fresh: false,
            })));
        } else if (event.type === 'item') {
            patch(event.index, {
                state: event.status, entry: event.entry, alternatives: event.alternatives, suggested: event.suggested,
                amount: event.amount, estimated: event.estimated, note: event.amount_note, fresh: event.status === 'tracked',
            });
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
        if (phase === 'running' || (photoMode ? !image : value.length < 2)) return;
        const controller = new AbortController();
        controllerRef.current = controller;
        queueRef.current = [];
        parsedRef.current = false;
        setCards([]); setError(null); setPhase('running'); setSettingsOpen(false);
        haptic('tap');
        // A just changed setting must be stored before the server reads it.
        await settingsSave.current?.catch(() => undefined);
        try {
            const request = photoMode && image
                ? { image, text: value.length >= 2 ? value : undefined, date, slot_id: slotId }
                : { text: value, date, slot_id: slotId };
            await streamSmartTrack(request, (event) => { queueRef.current.push(event); void pump(); }, controller.signal);
        } catch (caught: unknown) {
            if (controller.signal.aborted) return;
            setError(errorText(caught, 'Tracken fehlgeschlagen.'));
            queueRef.current = [];
            setCards((current) => current.map((card) => card.state === 'pending' ? { ...card, state: 'error' } : card));
            setPhase(parsedRef.current ? 'done' : 'input');
        }
    };

    const replacePhoto = async (file: File | undefined) => {
        if (!file) return;
        try { setImage(await photoToDataUrl(file)); setError(null); haptic('tap'); }
        catch (caught: unknown) { setError(errorText(caught, 'Das Foto konnte nicht gelesen werden.')); }
    };

    const trackMore = () => {
        haptic('tap');
        queueRef.current = [];
        parsedRef.current = false;
        setCards([]); setText(''); setError(null); setPhase('input');
        window.setTimeout(() => textRef.current?.focus(), 50);
    };

    const choose = async (index: number, option: SmartTrackOption) => {
        const card = cards[index];
        if (!card || card.busy) return;
        const amount = card.amountEdited && card.amount ? card.amount : option.amount;
        patch(index, { busy: true });
        try {
            const entry = await createTrackEntry({ date, slot_id: slotId, source: option.source, source_id: option.source_id, amount });
            onTracked(entry);
            if (card.entry) {
                const old = card.entry.id;
                // Only drop the old entry from the page once it is really gone, otherwise the day would count it twice unseen.
                try { await deleteTrackEntry(old); onRemoved(old); }
                catch { setError('Das vorherige Produkt konnte nicht entfernt werden. Lösch es bitte in der Liste.'); }
            }
            haptic('success');
            patch(index, {
                state: 'tracked', entry, changing: false, editing: false, busy: false, fresh: true,
                ...(card.amountEdited ? {} : { amount: option.amount, estimated: option.estimated, note: option.amount_note }),
            });
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
            patch(index, { state: 'removed', entry: null, changing: false, editing: false, busy: false });
        } catch (caught: unknown) {
            setError(errorText(caught, 'Löschen fehlgeschlagen.'));
            patch(index, { busy: false });
        }
    };

    const toggleEditing = (index: number) => {
        const card = cards[index];
        if (!card || card.busy) return;
        haptic('tap');
        const current = card.entry?.amount ?? card.amount ?? card.alternatives[0]?.amount ?? 100;
        patch(index, { editing: !card.editing, draft: toAmountInput(current), changing: false });
    };

    const saveAmount = async (index: number) => {
        const card = cards[index];
        const amount = card ? parseAmount(card.draft) : null;
        if (!card || amount == null || amount <= 0 || amount > 10000 || card.busy) return;
        if (!card.entry) {
            haptic('success');
            patch(index, { amount, amountEdited: true, estimated: false, note: null, editing: false });
            return;
        }
        patch(index, { busy: true });
        try {
            const updated = await updateTrackEntry(card.entry.id, amount);
            onUpdated(updated);
            haptic('success');
            patch(index, { entry: updated, amount, amountEdited: true, estimated: false, note: null, editing: false, busy: false, fresh: true });
        } catch (caught: unknown) {
            haptic('warning');
            setError(errorText(caught, 'Menge konnte nicht gespeichert werden.'));
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
            ? { ...card, state: 'removed', entry: null, changing: false, editing: false, busy: false }
            : { ...card, busy: false }));
        if (removed.size < tracked.length) setError('Einige Einträge konnten nicht entfernt werden.');
    };

    const activeIndex = cards.findIndex((card) => card.state === 'pending');
    const trackedCards = cards.filter((card) => card.entry);
    const totalKcal = trackedCards.reduce((sum, card) => sum + (card.entry?.kcal ?? 0), 0);

    /** The amount an option would be tracked with on this card. */
    const optionAmount = (card: Card, option: SmartTrackOption) => card.amountEdited && card.amount ? card.amount : option.amount;

    const optionRow = (index: number, card: Card, option: SmartTrackOption) => {
        const amount = optionAmount(card, option);
        const kcal = kcalFor(option, amount);
        return <li key={`${option.source}:${option.source_id}`}>
            <button type="button" disabled={card.busy} onClick={() => void choose(index, option)}
                className="tap flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left disabled:opacity-50"
                style={{ background: 'rgba(255,247,235,0.04)', border: `1px solid ${BORDER}` }}>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium" style={{ color: TEXT }}>{option.name}</span>
                    <span className="block truncate text-[11px]" style={{ color: DIM }}>
                        {[option.brand, `${fmt(option.kcal)} kcal`, option.protein != null ? `${fmt(option.protein)} g P` : null].filter(Boolean).join(' · ')}
                        <span style={{ color: FAINT }}> / 100 {option.unit}</span>
                    </span>
                </span>
                <span className="shrink-0 text-right">
                    <span className="block text-[11px] font-semibold tabular-nums" style={{ color: SAND }}>{fmtAmount(amount)} {option.unit}</span>
                    {kcal != null && <span className="block text-[10px] tabular-nums" style={{ color: DIM }}>{fmt(kcal)} kcal</span>}
                </span>
            </button>
        </li>;
    };

    /** Unsure item: the model's pick on top with a one-tap "Passt", the other candidates below. */
    const choiceList = (index: number, card: Card) => {
        const options = card.alternatives.filter((option) => !(card.entry && sameFood(option, card.entry)));
        const [first, ...rest] = options;
        if (!first) return null;
        if (!card.suggested || card.entry) return <ul className="forge-expand mt-2 space-y-1">{options.map((option) => optionRow(index, card, option))}</ul>;
        const amount = optionAmount(card, first);
        const kcal = kcalFor(first, amount);
        return <div className="forge-expand mt-2.5">
            <div className="rounded-xl p-3" style={{ background: 'rgba(232,197,138,0.07)', border: `1px solid ${SAND}55` }}>
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: SAND }}>Vorschlag</p>
                        <p className="mt-0.5 truncate text-[13.5px] font-medium" style={{ color: TEXT }}>{first.name}</p>
                        <p className="truncate text-[11px]" style={{ color: DIM }}>
                            {[first.brand, `${fmtAmount(amount)} ${first.unit}`, kcal != null ? `${fmt(kcal)} kcal` : null].filter(Boolean).join(' · ')}
                        </p>
                    </div>
                    <button type="button" disabled={card.busy} onClick={() => void choose(index, first)}
                        className="btn-forge flex h-10 shrink-0 items-center gap-1.5 px-4 text-[13px] disabled:opacity-50">
                        {card.busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Passt
                    </button>
                </div>
            </div>
            {rest.length > 0 && <>
                <p className="mb-1 mt-2.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: FAINT }}>Oder eines davon</p>
                <ul className="space-y-1">{rest.map((option) => optionRow(index, card, option))}</ul>
            </>}
        </div>;
    };

    const amountEditor = (index: number, card: Card) => {
        const option = (card.entry && card.alternatives.find((item) => sameFood(item, card.entry!))) || card.alternatives[0];
        const unit = card.entry?.unit ?? option?.unit ?? card.item.unit;
        const value = parseAmount(card.draft);
        const kcal = card.entry ? (card.entry.per_100.kcal ?? 0) * (value ?? 0) / 100 : option ? kcalFor(option, value ?? 0) : null;
        return <div className="forge-expand mt-3">
            <AmountInput value={card.draft} unit={unit} onChange={(draft) => patch(index, { draft })} servings={option?.servings ?? []} />
            <div className="mt-3 flex items-center gap-2">
                {kcal != null && <p className="flex-1 text-[13px] tabular-nums" style={{ color: DIM }}><span className="text-[18px] font-semibold" style={{ color: TEXT }}>{fmt(kcal)}</span> kcal</p>}
                <button type="button" onClick={() => patch(index, { editing: false })} className="tap h-10 rounded-xl px-3 text-[12.5px] font-semibold" style={{ color: DIM }}>Abbrechen</button>
                <button type="button" onClick={() => void saveAmount(index)} disabled={value == null || value <= 0 || card.busy}
                    className="btn-forge flex h-10 items-center gap-1.5 px-4 text-[13px] disabled:opacity-40">
                    {card.busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Übernehmen
                </button>
            </div>
        </div>;
    };

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

    const badge = (label: string) => <span className="rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>{label}</span>;

    const cardView = (card: Card, index: number) => {
        const { item, entry } = card;
        const title = entry ? entry.name : item.name;
        const brand = entry ? entry.brand : item.brand;
        const unit = entry?.unit ?? card.alternatives[0]?.unit ?? item.unit;
        const amount = entry?.amount ?? card.amount;
        const waiting = card.state === 'pending' && index !== activeIndex;
        // The amount can be set as soon as there is something to track with it.
        const editable = !card.busy && (card.state === 'tracked' || (card.state === 'ambiguous' && card.alternatives.length > 0));
        const amountText = card.state === 'pending' ? pendingAmount(item) : amount == null ? '' : `${fmtAmount(amount)} ${unit}`;
        return <li key={index} className={`forge-msg-in rounded-2xl p-3 ${card.fresh ? 'track-row-flash' : ''}`}
            style={{ background: 'rgba(255,247,235,0.035)', border: `1px solid ${card.editing ? `${SAND}44` : BORDER}`, opacity: waiting || card.state === 'removed' ? 0.55 : 1, transition: 'opacity 0.3s' }}>
            <div className="flex items-center gap-3">
                {marker(card, index)}
                <div className="min-w-0 flex-1">
                    <p className={`truncate text-[14px] font-medium ${card.state === 'removed' ? 'line-through' : ''}`} style={{ color: TEXT }}>{title}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px]" style={{ color: DIM }}>
                        {editable
                            ? <button type="button" onClick={() => toggleEditing(index)} aria-expanded={card.editing} aria-label={`Menge von ${title} ändern`}
                                className="tap -my-1 flex items-center gap-0.5 rounded-lg px-1.5 py-1 font-semibold tabular-nums"
                                style={{ color: SAND, background: card.editing ? 'rgba(232,197,138,0.16)' : 'rgba(232,197,138,0.08)' }}>
                                {amountText}<ChevronDown size={12} style={{ transform: card.editing ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} />
                            </button>
                            : amountText && <span className="tabular-nums">{amountText}</span>}
                        {brand && <span className="truncate">· {brand}</span>}
                        {card.note && card.state !== 'removed' && card.state !== 'pending' && badge(card.note)}
                        {card.estimated && card.state !== 'removed' && badge('geschätzt')}
                        {entry && <span>· {fmt(entry.protein)} g P</span>}
                        {card.state === 'pending' && index === activeIndex && <span style={{ color: SAND }}>· suche…</span>}
                        {card.state === 'ambiguous' && <span style={{ color: SAND }}>· welches meinst du?</span>}
                        {card.state === 'not_found' && <span>· nichts gefunden</span>}
                        {card.state === 'error' && <span style={{ color: '#fca5a5' }}>· fehlgeschlagen</span>}
                        {card.state === 'removed' && <span>· entfernt</span>}
                    </div>
                </div>
                {entry && <span key={`${entry.id}-${entry.amount}`} className="track-number shrink-0 text-[14px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(entry.kcal)}<span className="ml-0.5 text-[10px] font-normal" style={{ color: DIM }}>kcal</span></span>}
                {entry && <div className="flex shrink-0 items-center">
                    {card.alternatives.length > 1 && <button type="button" onClick={() => patch(index, { changing: !card.changing, editing: false })} disabled={card.busy} aria-label={`Anderes Produkt für ${title}`} aria-expanded={card.changing}
                        className="tap flex h-9 w-9 items-center justify-center rounded-full" style={{ color: card.changing ? SAND : DIM }}><ArrowLeftRight size={14} /></button>}
                    <button type="button" onClick={() => void remove(index)} disabled={card.busy} aria-label={`${title} entfernen`}
                        className="tap flex h-9 w-9 items-center justify-center rounded-full" style={{ color: DIM }}>{card.busy && !card.editing ? <Loader2 size={14} className="animate-spin" /> : <X size={15} />}</button>
                </div>}
            </div>
            {card.editing && amountEditor(index, card)}
            {card.state === 'ambiguous' && !card.editing && choiceList(index, card)}
            {card.state === 'tracked' && card.changing && choiceList(index, card)}
            {(card.state === 'ambiguous' || card.state === 'not_found' || card.state === 'error') && !card.editing && <button type="button" onClick={() => { onSearch(item.name); onClose(); }}
                className="tap mt-2 flex h-10 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><Search size={14} />Selbst suchen</button>}
        </li>;
    };

    const settingsPanel = <div className="mt-4 overflow-hidden rounded-2xl" style={{ background: 'rgba(255,247,235,0.03)', border: `1px solid ${BORDER}` }}>
        <button type="button" onClick={() => { haptic('tap'); setSettingsOpen((open) => !open); }} aria-expanded={settingsOpen}
            className="tap flex h-11 w-full items-center gap-2 px-3.5 text-left">
            <SlidersHorizontal size={14} style={{ color: SAND }} />
            <span className="flex-1 text-[12.5px] font-semibold" style={{ color: TEXT }}>Einstellungen</span>
            {settings && !settingsOpen && <span className="text-[11.5px]" style={{ color: DIM }}>{WEIGH_LABEL[settings.weigh_state]}</span>}
            <ChevronDown size={15} style={{ color: DIM, transform: settingsOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} />
        </button>
        {settingsOpen && <div className="forge-expand px-3.5 pb-3.5">
            <p className="text-[12px] font-medium" style={{ color: TEXT }}>Grammangaben bei Reis, Nudeln, Kartoffeln, Fleisch & Co.</p>
            <p className="mt-0.5 text-[11px] leading-snug" style={{ color: DIM }}>Gilt, wenn du keinen Zustand dazuschreibst. „200 g Reis gekocht“ geht immer vor.</p>
            <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-xl p-1" role="radiogroup" aria-label="Standard-Zustand" style={{ background: 'rgba(0,0,0,0.2)' }}>
                {(['raw', 'cooked'] as const).map((value) => {
                    const active = settings?.weigh_state === value;
                    return <button key={value} type="button" role="radio" aria-checked={active} disabled={!settings}
                        onClick={() => { if (!active) changeSettings({ ...(settings ?? { weigh_state: 'raw' }), weigh_state: value }); }}
                        className="tap h-10 rounded-lg text-[12.5px] font-semibold disabled:opacity-40"
                        style={active ? { color: '#16130f', background: SAND } : { color: DIM }}>{WEIGH_LABEL[value]}</button>;
                })}
            </div>
        </div>}
    </div>;

    const running = phase === 'running';
    const openCount = cards.filter((card) => card.state === 'ambiguous').length;
    const textField = (placeholder: string, rows: number) => <textarea ref={textRef} value={text} onChange={(event) => setText(event.target.value)} rows={rows} autoFocus={!photoMode} maxLength={1500}
        placeholder={placeholder} aria-label={photoMode ? 'Ergänzungen zum Foto' : 'Was hast du gegessen?'}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void start(); } }}
        className="mt-3 w-full resize-none rounded-2xl p-3.5 text-[16px] leading-snug outline-none"
        style={{ color: TEXT, background: 'rgba(255,247,235,0.05)', border: `1px solid ${text ? `${SAND}66` : BORDER}`, transition: 'border-color 0.2s' }} />;
    const errorBox = error && <p className="mt-3 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>;
    const title = photoMode ? 'Mahlzeit per Foto' : 'Mit Text tracken';

    return <ForgeSheet label={title} onClose={onClose}>
        <div className="p-1">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-[18px] font-semibold leading-snug" style={{ color: TEXT }}><Sparkles size={17} style={{ color: SAND }} />{title}</h2>
                    <p className="mt-0.5 text-[12px]" style={{ color: DIM }}>{photoMode ? 'Ich erkenne die Bestandteile und schätze die Mengen. Was ich nicht sehen kann, schreib dazu.' : 'Schreib, was du gegessen hast. Mengen darfst du schätzen lassen.'}</p>
                </div>
                <button type="button" onClick={onClose} aria-label="Schließen" className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><X size={18} /></button>
            </div>
            {image && <div className="relative mt-4">
                <img src={image} alt="Dein Foto" className={`w-full rounded-2xl object-cover ${phase === 'input' ? 'h-52' : 'h-36'}`} style={{ border: `1px solid ${BORDER}`, transition: 'height 0.3s' }} />
                {phase === 'input' && <button type="button" onClick={() => fileRef.current?.click()}
                    className="tap absolute bottom-2 right-2 flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold"
                    style={{ color: TEXT, background: 'rgba(22,19,15,0.78)', border: `1px solid ${BORDER}`, backdropFilter: 'blur(6px)' }}><ImagePlus size={14} />Anderes Foto</button>}
            </div>}
            {photoMode && <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-hidden="true" tabIndex={-1}
                onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void replacePhoto(file); }} />}

            {phase === 'input' && <div>
                {settingsPanel}
                {textField(photoMode ? PHOTO_PLACEHOLDER : PLACEHOLDER, photoMode ? 3 : 4)}
                {errorBox}
                <button type="button" onClick={() => void start()} disabled={photoMode ? !image : text.trim().length < 2} className="btn-forge mt-3 h-12 w-full text-[14px]">
                    <Sparkles size={16} />{photoMode ? 'Analysieren' : 'Tracken'}
                </button>
            </div>}

            {phase !== 'input' && <>
                <div className="mt-4 flex items-baseline justify-between px-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: DIM }}>{running && cards.length === 0 ? (photoMode ? 'Ich schaue mir das Foto an…' : 'Ich lese deinen Text…') : running ? 'Wird getrackt' : 'Fertig'}</p>
                    {trackedCards.length > 0 && <p key={Math.round(totalKcal)} className="track-number text-[20px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(totalKcal)}<span className="ml-1 text-[11px] font-normal" style={{ color: DIM }}>kcal</span></p>}
                </div>
                {running && cards.length === 0 && <div className="mt-2 space-y-2">{[0, 1, 2].map((item) => <div key={item} className="forge-skeleton h-[62px] rounded-2xl" />)}</div>}
                <ul className="mt-2 space-y-2">{cards.map(cardView)}</ul>
                {error && <p className="mt-3 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}
                {phase === 'done' && <div className="forge-msg-in mt-4">
                    {trackedCards.length > 0 && <div className="mb-2 flex justify-end">
                        <button type="button" onClick={() => void undoAll()} className="tap flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-semibold" style={{ color: '#fca5a5' }}><RotateCcw size={13} />Alles rückgängig</button>
                    </div>}
                    {openCount > 0 && <p className="mb-2 px-1 text-[11.5px]" style={{ color: SAND }}>{openCount === 1 ? '1 Lebensmittel ist' : `${openCount} Lebensmittel sind`} noch nicht getrackt.</p>}
                    <div className="flex gap-2">
                        {!photoMode && <button type="button" onClick={trackMore} className="tap flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13.5px] font-semibold" style={{ color: SAND, border: `1px solid ${SAND}55` }}><Plus size={16} />Weiter tracken</button>}
                        <button type="button" onClick={onClose} className="btn-forge h-12 flex-1 text-[14px]">Fertig</button>
                    </div>
                </div>}
            </>}
        </div>
    </ForgeSheet>;
}
