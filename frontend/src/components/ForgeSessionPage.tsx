import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CirclePlus, Loader2, MessageSquare, Plus, Send, Trash2 } from 'lucide-react';
import {
  addForgeSessionExercise, addForgeSessionSet, applyForgeSessionAction,
  completeForgeSession, deleteForgeSessionExercise, deleteForgeSessionSet,
  dismissForgeSessionAction, getForgeExercises, getForgeSession,
  sendForgeSessionChat, updateForgeSessionExercise, updateForgeSessionSet,
} from '../api/api';
import type { ForgeExercise, ForgeSession, ForgeSessionSet, ForgeSessionSetInput } from '../api/api';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.48)';
const BORDER = 'rgba(232,197,138,0.11)';

const toInput = (set: ForgeSessionSet, overrides: Partial<ForgeSessionSetInput> = {}): ForgeSessionSetInput => ({
  set_type: set.set_type,
  target_weight_kg: set.target_weight_kg,
  target_reps: set.target_reps,
  actual_weight_kg: set.actual_weight_kg,
  actual_reps: set.actual_reps,
  coach_suggested_weight_kg: set.coach_suggested_weight_kg,
  coach_suggested_reps: set.coach_suggested_reps,
  completed: set.completed,
  note: set.note,
  ...overrides,
});

const displayLoad = (weight: number | null, reps: number | null) => {
  if (weight == null && reps == null) return '—';
  return `${weight != null && weight > 0 ? `${weight} kg` : 'BW'}${reps != null ? ` × ${reps}` : ''}`;
};

export default function ForgeSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<ForgeSession | null>(null);
  const [library, setLibrary] = useState<ForgeExercise[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const activeExercise = useMemo(() => session?.exercises[activeIndex] ?? null, [session, activeIndex]);
  const setSessionSafe = (next: ForgeSession) => {
    setSession(next);
    setActiveIndex((current) => Math.min(current, Math.max(0, next.exercises.length - 1)));
  };

  useEffect(() => {
    if (!sessionId) return;
    Promise.all([getForgeSession(sessionId), getForgeExercises()])
      .then(([loadedSession, loadedLibrary]) => { setSessionSafe(loadedSession); setLibrary(loadedLibrary); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Session konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const mutate = async (operation: () => Promise<ForgeSession>) => {
    setSaving(true); setError(null);
    try { setSessionSafe(await operation()); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Änderung konnte nicht gespeichert werden.'); }
    finally { setSaving(false); }
  };

  const updateSet = (set: ForgeSessionSet, changes: Partial<ForgeSessionSetInput>) => {
    if (!session) return;
    void mutate(() => updateForgeSessionSet(session.id, set.id, toInput(set, changes)));
  };

  const addSet = () => {
    if (!session || !activeExercise) return;
    const last = activeExercise.sets[activeExercise.sets.length - 1];
    const draft: ForgeSessionSetInput = last ? toInput(last, { completed: false, actual_weight_kg: null, actual_reps: null }) : {
      set_type: 'working', target_weight_kg: null, target_reps: 10, actual_weight_kg: null, actual_reps: null,
      coach_suggested_weight_kg: null, coach_suggested_reps: null, completed: false, note: '',
    };
    void mutate(() => addForgeSessionSet(session.id, activeExercise.id, draft));
  };

  const addExercise = (exercise: ForgeExercise) => {
    if (!session) return;
    void mutate(async () => {
      const next = await addForgeSessionExercise(session.id, {
        exercise_id: exercise.id,
        machine_profile_name: exercise.machine_profiles[0]?.name ?? null,
        notes: '',
        sets: [{ set_type: 'working', target_weight_kg: null, target_reps: 10, actual_weight_kg: null, actual_reps: null, coach_suggested_weight_kg: null, coach_suggested_reps: null, completed: false, note: '' }],
      });
      setAddOpen(false);
      return next;
    });
  };

  const sendChat = async () => {
    if (!session || !chatInput.trim()) return;
    const message = chatInput.trim(); setChatInput('');
    await mutate(() => sendForgeSessionChat(session.id, message));
  };

  const complete = async () => {
    if (!session || !window.confirm('Session wirklich abschließen? Danach bleibt sie als Historie gespeichert.')) return;
    await mutate(async () => {
      const completed = await completeForgeSession(session.id);
      return completed;
    });
  };

  if (loading) return <div className="py-20 flex justify-center"><Loader2 className="animate-spin" style={{ color: SAND }} /></div>;
  if (!session || error && !session) return <div className="card-forge p-6 text-center text-[13px]" style={{ color: '#fca5a5' }}>{error || 'Session nicht gefunden.'}</div>;

  const completedSets = session.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.completed).length;
  const totalSets = session.exercises.flatMap((exercise) => exercise.sets).length;
  const activeLibraryExercise = library.find((exercise) => exercise.id === activeExercise?.source_exercise_id) ?? null;

  return <div className="space-y-4 forge-anim">
    <header className="flex items-start justify-between gap-3">
      <div className="flex gap-3"><button onClick={() => navigate('/dashboard')} className="tap mt-1 cursor-pointer" style={{ color: DIM }}><ArrowLeft size={18} /></button><div><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>{session.status === 'active' ? 'Live Session' : 'Abgeschlossen'}</p><h1 className="text-[22px] font-semibold tracking-tight mt-1" style={{ color: TEXT }}>{session.name}</h1><p className="text-[11px] mt-1" style={{ color: DIM }}>{completedSets}/{totalSets} Sätze abgeschlossen</p></div></div>
      {session.status === 'active' && <button onClick={() => void complete()} disabled={saving} className="tap text-[11px] font-medium cursor-pointer" style={{ color: SAND }}>Beenden</button>}
    </header>
    {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

    {activeExercise ? <>
      <div className="flex items-center justify-between gap-3"><button onClick={() => setActiveIndex((index) => Math.max(0, index - 1))} disabled={activeIndex === 0} className="tap cursor-pointer disabled:opacity-20" style={{ color: SAND }}><ChevronLeft size={20} /></button><p className="text-[11px]" style={{ color: DIM }}>Übung {activeIndex + 1} von {session.exercises.length}</p><button onClick={() => setActiveIndex((index) => Math.min(session.exercises.length - 1, index + 1))} disabled={activeIndex >= session.exercises.length - 1} className="tap cursor-pointer disabled:opacity-20" style={{ color: SAND }}><ChevronRight size={20} /></button></div>
      <section className="card-forge overflow-hidden" style={{ borderColor: `${SAND}22` }}>
        <div className="p-5 flex items-start justify-between gap-3"><div><h2 className="text-[20px] font-semibold" style={{ color: TEXT }}>{activeExercise.name}</h2>{activeLibraryExercise?.machine_profiles.length ? <select value={activeExercise.machine_profile_name ?? ''} disabled={session.status !== 'active'} onChange={(event) => void mutate(() => updateForgeSessionExercise(session.id, activeExercise.id, { machine_profile_name: event.target.value || null }))} className="mt-1 bg-transparent text-[11px] outline-none cursor-pointer" style={{ color: SAND }}><option value="">Maschine wählen</option>{activeLibraryExercise.machine_profiles.map((profile) => <option key={profile.id} value={profile.name}>{profile.name}{profile.model ? ` · ${profile.model}` : ''}</option>)}</select> : <p className="text-[11px] mt-1" style={{ color: DIM }}>{activeExercise.primary_muscle_group}{activeExercise.machine_profile_name ? ` · ${activeExercise.machine_profile_name}` : ''}</p>}</div>{session.status === 'active' && <button onClick={() => void mutate(() => deleteForgeSessionExercise(session.id, activeExercise.id))} className="tap cursor-pointer" style={{ color: DIM }}><Trash2 size={16} /></button>}</div>
        <div className="border-y" style={{ borderColor: 'rgba(255,247,235,0.06)' }}>
          <div className="grid px-4 py-2 text-[9px] uppercase tracking-wider" style={{ gridTemplateColumns: '36px 1fr 1fr 32px', color: DIM }}><span>Satz</span><span className="text-center">Ziel</span><span className="text-center">Heute</span><span /></div>
          {activeExercise.sets.map((set, index) => <div key={set.id} className="grid items-center gap-2 px-4 py-3" style={{ gridTemplateColumns: '36px 1fr 1fr 32px', background: index % 2 ? 'transparent' : 'rgba(255,247,235,0.025)' }}>
            <span className="text-[11px]" style={{ color: DIM }}>{set.set_type === 'warmup' ? 'W' : index + 1}</span>
            <span className="text-center text-[12px]" style={{ color: DIM }}>{displayLoad(set.target_weight_kg, set.target_reps)}</span>
            <div className="grid gap-1" style={{ gridTemplateColumns: '1fr 1fr' }}><input defaultValue={set.actual_weight_kg ?? ''} disabled={session.status !== 'active'} inputMode="decimal" onBlur={(event) => { const value = event.target.value === '' ? null : Number(event.target.value); if (value !== set.actual_weight_kg) updateSet(set, { actual_weight_kg: value }); }} placeholder="kg" className="input-forge min-w-0 !px-2 !py-2 text-center text-[11px]" /><input defaultValue={set.actual_reps ?? ''} disabled={session.status !== 'active'} inputMode="numeric" onBlur={(event) => { const value = event.target.value === '' ? null : Number(event.target.value); if (value !== set.actual_reps) updateSet(set, { actual_reps: value }); }} placeholder="Wdh." className="input-forge min-w-0 !px-2 !py-2 text-center text-[11px]" /></div>
            {session.status === 'active' ? <button onClick={() => updateSet(set, { completed: !set.completed, actual_weight_kg: set.actual_weight_kg ?? set.target_weight_kg, actual_reps: set.actual_reps ?? set.target_reps })} className="tap w-7 h-7 rounded-full flex items-center justify-center cursor-pointer" style={{ background: set.completed ? SAND : 'rgba(255,247,235,0.06)', color: set.completed ? '#16130f' : DIM }}><Check size={15} /></button> : <Check size={15} style={{ color: set.completed ? SAND : DIM }} />}
          </div>)}
        </div>
        {session.status === 'active' && <div className="p-3 flex gap-3"><button onClick={addSet} className="tap text-[11px] flex items-center gap-1 cursor-pointer" style={{ color: SAND }}><Plus size={14} />Satz</button>{activeExercise.sets.length > 1 && <button onClick={() => void mutate(() => deleteForgeSessionSet(session.id, activeExercise.sets[activeExercise.sets.length - 1].id))} className="tap text-[11px] flex items-center gap-1 cursor-pointer" style={{ color: DIM }}><Trash2 size={13} />Letzten löschen</button>}</div>}
      </section>
    </> : <div className="card-forge p-6 text-center text-[13px]" style={{ color: DIM }}>Diese Session hat noch keine Übungen.</div>}

    {session.status === 'active' && <button onClick={() => setAddOpen(!addOpen)} className="w-full card-forge p-3 flex items-center justify-center gap-2 text-[12px] font-medium tap cursor-pointer" style={{ color: SAND }}><CirclePlus size={15} />Übung hinzufügen</button>}
    {addOpen && <div className="card-forge p-3 space-y-2">{library.map((exercise) => <button key={exercise.id} onClick={() => addExercise(exercise)} className="w-full text-left rounded-xl px-3 py-3 tap cursor-pointer" style={{ background: 'rgba(255,247,235,0.035)' }}><span className="text-[13px] font-medium" style={{ color: TEXT }}>{exercise.name}</span><span className="block text-[10px] mt-0.5" style={{ color: DIM }}>{exercise.primary_muscle_group}</span></button>)}</div>}

    <section className="card-forge overflow-hidden" style={{ borderColor: chatOpen ? `${SAND}2b` : BORDER }}>
      <button onClick={() => setChatOpen(!chatOpen)} className="w-full p-4 flex items-center justify-between tap cursor-pointer"><span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: TEXT }}><MessageSquare size={16} style={{ color: SAND }} />Forge in dieser Session</span><span className="text-[11px]" style={{ color: DIM }}>{chatOpen ? 'Schließen' : 'Fragen'}</span></button>
      {chatOpen && <div className="border-t p-3 space-y-3" style={{ borderColor: 'rgba(255,247,235,0.06)' }}>
        {session.messages.map((message) => <div key={message.id} className={message.role === 'user' ? 'pl-8' : 'pr-4'}><div className="rounded-2xl px-3 py-2.5 text-[12px] leading-relaxed" style={{ color: message.role === 'user' ? '#16130f' : TEXT, background: message.role === 'user' ? SAND : 'rgba(255,247,235,0.06)' }}>{message.content}</div>{message.proposed_action && <div className="mt-2 rounded-xl p-3" style={{ border: `1px solid ${SAND}44`, background: 'rgba(232,197,138,0.06)' }}><p className="text-[11px] font-medium" style={{ color: SAND }}>{message.proposed_action.title}</p>{message.action_status === 'pending' ? <div className="flex gap-3 mt-2"><button onClick={() => void mutate(() => applyForgeSessionAction(session.id, message.id))} className="text-[11px] font-medium cursor-pointer" style={{ color: SAND }}>Übernehmen</button><button onClick={() => void mutate(() => dismissForgeSessionAction(session.id, message.id))} className="text-[11px] cursor-pointer" style={{ color: DIM }}>Ablehnen</button></div> : <p className="text-[10px] mt-1" style={{ color: DIM }}>{message.action_status === 'applied' ? 'Übernommen' : 'Abgelehnt'}</p>}</div>}</div>)}
        {session.status === 'active' && <div className="flex gap-2"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sendChat(); }} placeholder="z. B. Maschine besetzt – Alternative?" className="input-forge min-w-0 flex-1 text-[12px]" /><button onClick={() => void sendChat()} disabled={saving || !chatInput.trim()} className="tap w-10 rounded-xl flex items-center justify-center cursor-pointer" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button></div>}
      </div>}
    </section>
  </div>;
}
