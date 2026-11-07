import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ChevronDown, Leaf, Loader2, Plus } from 'lucide-react';
import { createTrackEntry, getFoodDetail, getMealSlots, type FoodDetail, type FoodNutrient, type FoodSource, type MealSlot } from '../../api/api';
import AmountInput from './AmountInput';
import { SlotIcon } from './shared';
import { BORDER, CARBS, DIM, FAINT, FAT, PROTEIN, SAND, TEXT, berlinToday, fmt, isValidIsoDate, parseAmount, scaled, toAmountInput } from './trackUtils';

const GROUP_ORDER = ['Makronährstoffe', 'Fette', 'Kohlenhydrate', 'Ballaststoffe', 'Vitamine', 'Fettlösliche Vitamine', 'Wasserlösliche Vitamine', 'Mineralstoffe', 'Elemente'];

export default function FoodDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { source = 'off', sourceId = '' } = useParams();
  const [params] = useSearchParams();
  const date = isValidIsoDate(params.get('date')) ? params.get('date')! : berlinToday();
  const slotParam = params.get('slot');
  const initial = (location.state as { food?: FoodDetail } | null)?.food ?? null;

  const [food, setFood] = useState<FoodDetail | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(initial ? toAmountInput(initial.default_amount) : '');
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [slotId, setSlotId] = useState<string | null>(slotParam && slotParam !== 'unassigned' ? slotParam : null);
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showIngredients, setShowIngredients] = useState(false);

  useEffect(() => {
    getMealSlots().then((data) => setSlots(data.items)).catch(() => setSlots([]));
    if (initial && initial.source_id === sourceId) return;
    getFoodDetail(source as FoodSource, sourceId)
      .then((data) => { setFood(data); setAmount(toAmountInput(data.default_amount)); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Produkt konnte nicht geladen werden.'));
  }, [source, sourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const qty = parseAmount(amount) ?? 0;
  const slot = slots.find((item) => item.id === slotId) ?? null;
  const backTarget = `/nutrition/track/${slotParam ?? 'unassigned'}${date === berlinToday() ? '' : `?date=${date}`}`;

  const groups = useMemo(() => {
    const map = new Map<string, FoodNutrient[]>();
    for (const item of food?.nutrients ?? []) {
      const key = item.g || 'Sonstiges';
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()].sort((a, b) => (GROUP_ORDER.indexOf(a[0]) + 100) % 100 - (GROUP_ORDER.indexOf(b[0]) + 100) % 100);
  }, [food]);

  const add = async () => {
    if (!food || !qty) return;
    setSaving(true); setError(null);
    try {
      const entry = await createTrackEntry({ date, slot_id: slotId, source: food.source, source_id: food.source_id, amount: qty });
      navigator.vibrate?.(15);
      navigate(`/nutrition/track/${slotId ?? 'unassigned'}${date === berlinToday() ? '' : `?date=${date}`}`, { replace: true, state: { added: entry } });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Hinzufügen fehlgeschlagen.');
      setSaving(false);
    }
  };

  if (!food) return <div className="space-y-4">
    <button type="button" onClick={() => navigate(backTarget)} aria-label="Zurück" className="tap flex h-11 w-11 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><ArrowLeft size={19} /></button>
    {error ? <div className="card-forge p-6 text-center text-[13px]" style={{ color: '#fca5a5' }}>{error}</div>
      : <div className="space-y-3"><div className="forge-skeleton h-16 rounded-2xl" /><div className="forge-skeleton h-40 rounded-3xl" /><div className="forge-skeleton h-28 rounded-3xl" /></div>}
  </div>;

  const unit = food.unit;
  const kcal = scaled(food.kcal, qty);
  const rows: { label: string; per100: number | null; sub?: boolean; unit?: string; digits?: number }[] = [
    { label: 'Energie', per100: food.kcal, unit: 'kcal' },
    { label: 'Fett', per100: food.fat },
    { label: 'davon gesättigte Fettsäuren', per100: food.saturated, sub: true },
    { label: 'Kohlenhydrate', per100: food.carbs },
    { label: 'davon Zucker', per100: food.sugar, sub: true },
    { label: 'Ballaststoffe', per100: food.fiber },
    { label: 'Eiweiß', per100: food.protein },
    { label: 'Salz', per100: food.salt, digits: 2 },
  ];
  const macroKcal = (food.protein ?? 0) * 4 + (food.carbs ?? 0) * 4 + (food.fat ?? 0) * 9 || 1;
  const split = [
    { label: 'Protein', value: scaled(food.protein, qty), share: ((food.protein ?? 0) * 4) / macroKcal, color: PROTEIN },
    { label: 'Carbs', value: scaled(food.carbs, qty), share: ((food.carbs ?? 0) * 4) / macroKcal, color: CARBS },
    { label: 'Fett', value: scaled(food.fat, qty), share: ((food.fat ?? 0) * 9) / macroKcal, color: FAT },
  ];

  return <div className="space-y-4 pb-36">
    <header className="forge-anim flex items-start gap-3">
      <button type="button" onClick={() => navigate(backTarget)} aria-label="Zurück" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><ArrowLeft size={19} /></button>
      <div className="min-w-0 flex-1 pt-0.5">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight" style={{ color: TEXT }}>{food.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" style={{ color: DIM }}>
          {food.brand && <span style={{ color: SAND }}>{food.brand}</span>}
          {food.quantity_label && <span>{food.quantity_label}</span>}
          {food.source === 'bls' && <span className="flex items-center gap-1" style={{ color: '#83d6ad' }}><Leaf size={11} />Grundnahrungsmittel</span>}
        </p>
      </div>
    </header>

    {!food.trackable && <div className="flex items-start gap-3 rounded-2xl px-4 py-3" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)' }}>
      <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: CARBS }} />
      <p className="text-[12px] leading-relaxed" style={{ color: TEXT }}>Für dieses Produkt fehlen Nährwerte. Such nach einem vergleichbaren Produkt oder einem Grundnahrungsmittel.</p>
    </div>}
    {food.quality === 'suspect' && food.trackable && <p className="rounded-2xl px-4 py-2.5 text-[11.5px]" style={{ color: CARBS, background: 'rgba(251,191,36,0.07)' }}>Die Nährwerte wirken unstimmig. Bitte mit der Verpackung vergleichen.</p>}

    <section className="card-forge forge-anim forge-d1 p-5" style={{ borderColor: `${SAND}24` }}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: DIM }}>Für {fmt(qty, 1)} {unit}</p>
          <p key={Math.round(kcal ?? 0)} className="track-number mt-1 text-[44px] font-light leading-none tabular-nums" style={{ color: TEXT }}>{fmt(kcal)}<span className="ml-1.5 text-[15px]" style={{ color: DIM }}>kcal</span></p>
        </div>
        <p className="pb-1 text-right text-[11px]" style={{ color: FAINT }}>{fmt(food.kcal)} kcal<br />pro 100 {unit}</p>
      </div>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full" style={{ background: 'rgba(255,247,235,0.07)' }} aria-hidden="true">
        {split.map((item) => <span key={item.label} style={{ width: `${item.share * 100}%`, background: item.color, transition: 'width 0.5s' }} />)}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">{split.map((item) => <div key={item.label}>
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: DIM }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />{item.label}</p>
        <p className="mt-1 text-[18px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(item.value, 1)}<span className="ml-0.5 text-[11px] font-normal" style={{ color: DIM }}>g</span></p>
        <p className="text-[10px] tabular-nums" style={{ color: FAINT }}>{Math.round(item.share * 100)} % kcal</p>
      </div>)}</div>
    </section>

    <section className="card-forge forge-anim forge-d2 p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: DIM }}>Menge</p>
      <AmountInput value={amount} unit={unit} onChange={setAmount} servings={food.servings} />
      {slots.length > 0 && <div className="forge-chip-row -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1" role="radiogroup" aria-label="Mahlzeit">{slots.map((item) => {
        const active = item.id === slotId;
        return <button key={item.id} type="button" role="radio" aria-checked={active} onClick={() => setSlotId(item.id)} className="tap flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px]"
          style={{ color: active ? SAND : DIM, background: active ? 'rgba(232,197,138,0.12)' : 'transparent', border: `1px solid ${active ? `${SAND}66` : BORDER}` }}><SlotIcon name={item.name} size={13} />{item.name}</button>;
      })}</div>}
    </section>

    <section className="card-forge forge-anim forge-d3 overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 pb-2 pt-3.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: DIM }}>
        <span>Nährwerte</span><span className="text-right">100 {unit}</span><span className="w-16 text-right">{fmt(qty, 1)} {unit}</span>
      </div>
      {rows.map((row, index) => <div key={row.label} className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2 text-[13px] tabular-nums" style={{ background: index % 2 ? 'transparent' : 'rgba(255,247,235,0.025)' }}>
        <span className={row.sub ? 'pl-3 text-[12px]' : ''} style={{ color: row.sub ? DIM : TEXT }}>{row.label}</span>
        <span className="text-right" style={{ color: DIM }}>{row.per100 == null ? '–' : `${fmt(row.per100, row.digits ?? 1)} ${row.unit ?? 'g'}`}</span>
        <span className="w-16 text-right font-medium" style={{ color: TEXT }}>{row.per100 == null ? '–' : `${fmt(scaled(row.per100, qty), row.digits ?? 1)} ${row.unit ?? 'g'}`}</span>
      </div>)}
      {groups.length > 0 && <>
        <button type="button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll} className="tap flex w-full items-center justify-between border-t px-4 py-3 text-[12.5px] font-medium" style={{ color: SAND, borderColor: BORDER }}>
          {showAll ? 'Weniger anzeigen' : `Alle Nährstoffe (${food.nutrients.length})`}<ChevronDown size={15} style={{ transform: showAll ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} />
        </button>
        {showAll && <div className="forge-expand pb-2">{groups.map(([group, items]) => <div key={group}>
          <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: SAND }}>{group}</p>
          {items.map((item) => <div key={item.k} className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-1.5 text-[12px] tabular-nums">
            <span style={{ color: TEXT }}>{item.l}</span>
            <span className="text-right" style={{ color: DIM }}>{fmt(item.v, 2)} {item.u}</span>
            <span className="w-16 text-right" style={{ color: TEXT }}>{fmt(scaled(item.v, qty), 2)} {item.u}</span>
          </div>)}
        </div>)}</div>}
      </>}
    </section>

    {(food.ingredients || food.allergens.length > 0) && <section className="card-forge p-4">
      {food.allergens.length > 0 && <div className="flex flex-wrap gap-1.5">{food.allergens.map((item) => <span key={item} className="rounded-full px-2.5 py-1 text-[11px] capitalize" style={{ color: CARBS, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>{item}</span>)}</div>}
      {food.ingredients && <>
        <button type="button" onClick={() => setShowIngredients(!showIngredients)} aria-expanded={showIngredients} className={`tap flex w-full items-center justify-between text-[12.5px] font-medium ${food.allergens.length ? 'mt-3' : ''}`} style={{ color: SAND }}>Zutaten<ChevronDown size={15} style={{ transform: showIngredients ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} /></button>
        <p className={`mt-2 text-[12px] leading-relaxed ${showIngredients ? '' : 'line-clamp-2'}`} style={{ color: DIM }}>{food.ingredients}</p>
      </>}
    </section>}

    <p className="px-2 text-center text-[10px]" style={{ color: FAINT }}>Quelle: {food.attribution}</p>
    {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

    <div className="fixed inset-x-0 bottom-[64px] z-30 px-4 pb-3 pt-6" style={{ background: 'linear-gradient(180deg, rgba(22,19,15,0) 0%, rgba(22,19,15,0.96) 45%)' }}>
      <div className="mx-auto max-w-2xl">
        <button type="button" onClick={() => void add()} disabled={!food.trackable || !qty || saving} className="btn-forge h-14 w-full text-[15px] disabled:opacity-40">
          {saving ? <Loader2 size={17} className="animate-spin" /> : <Plus size={18} />}
          {slot ? `Zu ${slot.name} hinzufügen` : 'Hinzufügen'}
          {qty > 0 && food.trackable && <span className="ml-1 rounded-full px-2 py-0.5 text-[12px] tabular-nums" style={{ background: 'rgba(22,19,15,0.14)' }}>{fmt(kcal)} kcal</span>}
        </button>
      </div>
    </div>
  </div>;
}
