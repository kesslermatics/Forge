import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Leaf, Loader2, Plus } from 'lucide-react';
import { createTrackEntry, getFoodDetail, getMealSlots, type FoodDetail, type FoodNutrient, type FoodSource, type MealSlot } from '../../api/api';
import { canGoBack, haptic, useGoBack } from '../navigation';
import {
  BORDER, CARBS, DIM, FAINT, FAT, PROTEIN, SAND, TEXT, berlinToday, fmt, fmtAmount, isValidIsoDate, parseAmount, scaled, setTrackFlash, toAmountInput,
} from './trackUtils';

const GROUP_ORDER = ['Makronährstoffe', 'Fette', 'Kohlenhydrate', 'Ballaststoffe', 'Vitamine', 'Fettlösliche Vitamine', 'Wasserlösliche Vitamine', 'Mineralstoffe', 'Elemente'];

/** A unit in the amount dropdown: the base unit (g/ml) or a serving such as "Portion (40 g)". */
interface AmountUnit { id: string; short: string; label: string; factor: number }

function unitsFor(food: FoodDetail): AmountUnit[] {
  const base: AmountUnit = { id: 'base', short: food.unit, label: food.unit === 'ml' ? 'Milliliter (ml)' : 'Gramm (g)', factor: 1 };
  const servings = food.servings
    .filter((serving) => serving.amount > 0 && !(serving.amount === 100 && !serving.detail))
    .map((serving, index): AmountUnit => ({
      id: `s${index}`, short: serving.label, factor: serving.amount,
      label: `${serving.label} (${fmtAmount(serving.amount)} ${food.unit})`,
    }));
  return [base, ...servings];
}

/** Start with a serving when the default amount is exactly one, otherwise with grams. */
function initialAmount(food: FoodDetail): { unitId: string; value: string } {
  const match = unitsFor(food).find((unit) => unit.id !== 'base' && Math.abs(unit.factor - food.default_amount) < 0.05);
  return match ? { unitId: match.id, value: '1' } : { unitId: 'base', value: toAmountInput(food.default_amount) };
}

export default function FoodDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { source = 'off', sourceId = '' } = useParams();
  const [params] = useSearchParams();
  const date = isValidIsoDate(params.get('date')) ? params.get('date')! : berlinToday();
  const slotParam = params.get('slot');
  const slotId = slotParam && slotParam !== 'unassigned' ? slotParam : null;
  const slotUrl = `/nutrition/track/${slotParam ?? 'unassigned'}${date === berlinToday() ? '' : `?date=${date}`}`;
  const goBack = useGoBack(slotUrl);
  const initial = (location.state as { food?: FoodDetail } | null)?.food ?? null;

  const [food, setFood] = useState<FoodDetail | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(() => (initial ? initialAmount(initial) : { unitId: 'base', value: '' }));
  const [slot, setSlot] = useState<MealSlot | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showIngredients, setShowIngredients] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const amountBarRef = useRef<HTMLDivElement>(null);

  // The unit list opens above the amount bar; a tap outside or Escape closes it.
  useEffect(() => {
    if (!unitOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!amountBarRef.current?.contains(event.target as Node)) setUnitOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setUnitOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [unitOpen]);

  useEffect(() => {
    if (slotId) getMealSlots().then((data) => setSlot(data.items.find((item) => item.id === slotId) ?? null)).catch(() => undefined);
    if (initial && initial.source_id === sourceId) return;
    getFoodDetail(source as FoodSource, sourceId)
      .then((data) => { setFood(data); setAmount(initialAmount(data)); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Produkt konnte nicht geladen werden.'));
  }, [source, sourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const units = useMemo(() => (food ? unitsFor(food) : []), [food]);
  const unit = units.find((item) => item.id === amount.unitId) ?? units[0];
  const count = parseAmount(amount.value) ?? 0;
  const qty = unit ? Math.round(count * unit.factor * 10) / 10 : 0;

  const groups = useMemo(() => {
    const map = new Map<string, FoodNutrient[]>();
    for (const item of food?.nutrients ?? []) {
      const key = item.g || 'Sonstiges';
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()].sort((a, b) => (GROUP_ORDER.indexOf(a[0]) + 100) % 100 - (GROUP_ORDER.indexOf(b[0]) + 100) % 100);
  }, [food]);

  const changeUnit = (unitId: string) => {
    const next = units.find((item) => item.id === unitId);
    if (!next) return;
    haptic('tap');
    setUnitOpen(false);
    // Servings start at 1; back to grams keeps the current weight.
    setAmount({ unitId, value: next.id === 'base' ? toAmountInput(qty || 100) : '1' });
  };

  const add = async () => {
    if (!food || !qty || saving) return;
    setSaving(true); setError(null);
    haptic('tap');
    try {
      const entry = await createTrackEntry({ date, slot_id: slotId, source: food.source, source_id: food.source_id, amount: qty });
      haptic('success');
      setTrackFlash(entry);
      if (canGoBack()) navigate(-1);
      else navigate(slotUrl, { replace: true });
    } catch (caught: unknown) {
      haptic('warning');
      setError(caught instanceof Error ? caught.message : 'Hinzufügen fehlgeschlagen.');
      setSaving(false);
    }
  };

  if (!food || !unit) return <div className="space-y-4">
    <button type="button" onClick={goBack} aria-label="Zurück" className="tap flex h-11 w-11 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><ArrowLeft size={19} /></button>
    {error ? <div className="card-forge p-6 text-center text-[13px]" style={{ color: '#fca5a5' }}>{error}</div>
      : <div className="space-y-3"><div className="forge-skeleton h-16 rounded-2xl" /><div className="forge-skeleton h-40 rounded-3xl" /><div className="forge-skeleton h-28 rounded-3xl" /></div>}
  </div>;

  const base = food.unit;
  const kcal = scaled(food.kcal, qty);
  const amountLabel = unit.id === 'base' ? `${fmt(qty, 1)} ${base}` : `${fmtAmount(count)} × ${unit.short} · ${fmt(qty, 1)} ${base}`;
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

  return <div className="space-y-4 pb-32">
    <header className="forge-anim flex items-start gap-3">
      <button type="button" onClick={goBack} aria-label="Zurück" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><ArrowLeft size={19} /></button>
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
        <div className="min-w-0">
          <p className="truncate text-[10px] uppercase tracking-[0.16em]" style={{ color: DIM }}>Für {amountLabel}</p>
          <p key={Math.round(kcal ?? 0)} className="track-number mt-1 text-[44px] font-light leading-none tabular-nums" style={{ color: TEXT }}>{fmt(kcal)}<span className="ml-1.5 text-[15px]" style={{ color: DIM }}>kcal</span></p>
        </div>
        <p className="shrink-0 pb-1 text-right text-[11px]" style={{ color: FAINT }}>{fmt(food.kcal)} kcal<br />pro 100 {base}</p>
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

    <section className="card-forge forge-anim forge-d2 overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 pb-2 pt-3.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: DIM }}>
        <span>Nährwerte</span><span className="text-right">100 {base}</span><span className="w-16 text-right">{fmt(qty, 1)} {base}</span>
      </div>
      {rows.map((row, index) => <div key={row.label} className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2 text-[13px] tabular-nums" style={{ background: index % 2 ? 'transparent' : 'rgba(255,247,235,0.025)' }}>
        <span className={row.sub ? 'pl-3 text-[12px]' : ''} style={{ color: row.sub ? DIM : TEXT }}>{row.label}</span>
        <span className="text-right" style={{ color: DIM }}>{row.per100 == null ? '–' : `${fmt(row.per100, row.digits ?? 1)} ${row.unit ?? 'g'}`}</span>
        <span className="w-16 text-right font-medium" style={{ color: TEXT }}>{row.per100 == null ? '–' : `${fmt(scaled(row.per100, qty), row.digits ?? 1)} ${row.unit ?? 'g'}`}</span>
      </div>)}
      {groups.length > 0 && <>
        <button type="button" onClick={() => { haptic('tap'); setShowAll(!showAll); }} aria-expanded={showAll} className="tap flex w-full items-center justify-between border-t px-4 py-3 text-[12.5px] font-medium" style={{ color: SAND, borderColor: BORDER }}>
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

    {/* Amount bar: value · unit dropdown · add. Sits above the tab bar, and above the keyboard while typing. */}
    <div className="fixed inset-x-0 z-30" style={{ bottom: 'var(--forge-nav-h, 64px)', transition: 'bottom 0.2s' }}>
      <form onSubmit={(event) => { event.preventDefault(); void add(); }} className="mx-auto max-w-2xl px-3 pb-3 pt-2.5"
        style={{ background: 'linear-gradient(180deg, rgba(22,19,15,0) 0%, rgba(22,19,15,0.97) 28%)' }}>
        <p className="truncate px-1 pb-2 text-[11px]" style={{ color: DIM }}>
          {slot ? <>Zu <span style={{ color: SAND }}>{slot.name}</span> · </> : null}<span className="tabular-nums" style={{ color: TEXT }}>{fmt(kcal)} kcal</span>{unit.id !== 'base' && <span className="tabular-nums"> · {fmt(qty, 1)} {base}</span>}
        </p>
        <div ref={amountBarRef} className="relative flex items-stretch gap-2 rounded-[20px] p-1.5" style={{ background: '#211c14', border: `1px solid ${SAND}33`, boxShadow: '0 18px 40px -20px rgba(0,0,0,0.9)' }}>
          {unitOpen && <ul role="listbox" aria-label="Einheit oder Portion" className="forge-pop-up absolute inset-x-0 bottom-full z-10 mb-2 max-h-[min(46dvh,320px)] overflow-y-auto overscroll-contain rounded-[20px] p-1.5"
            style={{ background: '#211c14', border: `1px solid ${SAND}33`, boxShadow: '0 -18px 40px -20px rgba(0,0,0,0.9)' }}>
            {units.map((item) => {
              const active = item.id === unit.id;
              return <li key={item.id} role="option" aria-selected={active}>
                <button type="button" onClick={() => changeUnit(item.id)} className="tap flex min-h-12 w-full items-center gap-2 rounded-2xl px-3 text-left text-[14px]"
                  style={{ color: active ? SAND : TEXT, background: active ? 'rgba(232,197,138,0.1)' : 'transparent' }}>
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {active && <Check size={16} className="shrink-0" />}
                </button>
              </li>;
            })}
          </ul>}
          <label className="flex h-12 w-[92px] shrink-0 items-center rounded-2xl px-3" style={{ background: 'rgba(255,247,235,0.06)' }}>
            <input
              value={amount.value}
              onChange={(event) => setAmount((current) => ({ ...current, value: event.target.value.replace(/[^\d.,]/g, '').slice(0, 7) }))}
              onFocus={(event) => event.target.select()}
              inputMode="decimal"
              enterKeyHint="done"
              aria-label="Menge"
              className="track-amount-input w-full min-w-0 bg-transparent text-center text-[18px] font-semibold tabular-nums outline-none"
              style={{ color: TEXT }}
            />
          </label>
          <button type="button" onClick={() => { haptic('tap'); setUnitOpen((open) => !open); }} disabled={units.length < 2}
            aria-haspopup="listbox" aria-expanded={unitOpen} aria-label="Einheit oder Portion"
            className="tap relative flex h-12 min-w-0 flex-1 items-center gap-1.5 rounded-2xl px-3 text-left" style={{ background: 'rgba(255,247,235,0.06)' }}>
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium" style={{ color: TEXT }}>
              {unit.short}{unit.id !== 'base' && <span className="ml-1 text-[12px] font-normal" style={{ color: DIM }}>({fmtAmount(unit.factor)} {base})</span>}
            </span>
            <ChevronDown size={16} className="shrink-0" style={{ color: SAND, transform: unitOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s', opacity: units.length < 2 ? 0.4 : 1 }} />
          </button>
          <button type="submit" disabled={!food.trackable || !qty || saving} aria-label={slot ? `Zu ${slot.name} hinzufügen` : 'Hinzufügen'}
            className="tap flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl disabled:opacity-40"
            style={{ color: '#16130f', background: `linear-gradient(140deg, ${SAND}, #d4aa70)`, boxShadow: '0 10px 22px -12px rgba(232,197,138,0.8)' }}>
            {saving ? <Loader2 size={19} className="animate-spin" /> : <Plus size={22} strokeWidth={2.4} />}
          </button>
        </div>
      </form>
    </div>
  </div>;
}
