import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Save, Settings2, Sparkles } from 'lucide-react';
import { addForgeSessionExercise, createForgeExercise, generateForgeExerciseDraft, generateForgeSessionExerciseAdditionCoaching, getForgeExercises, getForgeMachineProfiles, updateForgeExercise } from '../api/api';
import type { ForgeEquipment, ForgeExerciseInput, ForgeMachineProfile } from '../api/api';

const SAND = '#e8c58a'; const TEXT = '#f2ece0'; const DIM = 'rgba(242,236,226,0.48)'; const BORDER = 'rgba(232,197,138,0.11)';
const MUSCLES = ['Chest', 'Back', 'Lats', 'Traps', 'Shoulders', 'Biceps', 'Triceps', 'Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Forearms', 'Full Body', 'Other'];
const EQUIPMENT: Array<{ value: ForgeEquipment; label: string }> = [{ value: 'none', label: 'Ohne' }, { value: 'barbell', label: 'Langhantel' }, { value: 'dumbbell', label: 'Kurzhantel' }, { value: 'kettlebell', label: 'Kettlebell' }, { value: 'cable', label: 'Kabelzug' }, { value: 'machine', label: 'Maschine' }, { value: 'other', label: 'Sonstiges' }];
const EDITOR_DRAFT_KEY = 'forge-exercise-editor-draft';
const blank = (): ForgeExerciseInput => ({ name: '', icon: 'Dumbbell', equipment: 'other', primary_muscle_group: 'Other', secondary_muscle_groups: [], machine_profile_ids: [] });

export default function ForgeExerciseEditorPage() {
  const { exerciseId } = useParams<{ exerciseId: string }>(); const [searchParams] = useSearchParams(); const navigate = useNavigate();
  const editingId = exerciseId === 'new' ? null : exerciseId ?? null; const returnTo = searchParams.get('returnTo');
  const [draft, setDraft] = useState<ForgeExerciseInput>(blank()); const [profiles, setProfiles] = useState<ForgeMachineProfile[]>([]);
  const [loading, setLoading] = useState(Boolean(editingId)); const [saving, setSaving] = useState(false); const [drafting, setDrafting] = useState(false); const [aiInstructions, setAiInstructions] = useState(''); const [error, setError] = useState<string | null>(null);
  useEffect(() => { Promise.all([getForgeExercises(), getForgeMachineProfiles()]).then(([exercises, machineProfiles]) => { setProfiles(machineProfiles); const saved = sessionStorage.getItem(EDITOR_DRAFT_KEY); if (saved) { const parsed = JSON.parse(saved) as { path: string; draft: ForgeExerciseInput }; if (parsed.path === window.location.pathname + window.location.search) { setDraft(parsed.draft); sessionStorage.removeItem(EDITOR_DRAFT_KEY); return; } } const exercise = exercises.find((item) => item.id === editingId); if (exercise) setDraft({ name: exercise.name, icon: exercise.icon, equipment: exercise.equipment, primary_muscle_group: exercise.primary_muscle_group, secondary_muscle_groups: exercise.secondary_muscle_groups, machine_profile_ids: exercise.machine_profiles.map((profile) => profile.id) }); }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Übung konnte nicht geladen werden.')).finally(() => setLoading(false)); }, [editingId]);
  const machineCapable = draft.equipment === 'machine' || draft.equipment === 'cable';
  const createAiDraft = async () => {
    const instructions = aiInstructions.trim();
    if (instructions.length < 3) { setError('Beschreibe kurz, welche Übung du erstellen möchtest.'); return; }
    setDrafting(true); setError(null);
    try {
      const result = await generateForgeExerciseDraft(instructions, []);
      setDraft((current) => ({
        ...current,
        name: result.draft.name,
        icon: result.draft.icon,
        equipment: result.draft.equipment,
        primary_muscle_group: result.draft.primary_muscle_group,
        secondary_muscle_groups: result.draft.secondary_muscle_groups,
        machine_profile_ids: result.draft.equipment === 'machine' || result.draft.equipment === 'cable' ? current.machine_profile_ids : [],
      }));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'KI-Entwurf konnte nicht erstellt werden.');
    } finally { setDrafting(false); }
  };
  const toggleProfile = (id: string) => setDraft({ ...draft, machine_profile_ids: draft.machine_profile_ids.includes(id) ? draft.machine_profile_ids.filter((item) => item !== id) : [...draft.machine_profile_ids, id] });
  const save = async () => {
    if (!draft.name.trim()) { setError('Gib der Übung einen Namen.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = { ...draft, machine_profile_ids: machineCapable ? draft.machine_profile_ids : [] };
      const saved = editingId ? await updateForgeExercise(editingId, payload) : await createForgeExercise(payload);
      const sessionMatch = !editingId ? returnTo?.match(/^\/forge\/session\/([^/?]+)/) : null;
      if (sessionMatch) {
        const updatedSession = await addForgeSessionExercise(sessionMatch[1], {
          exercise_id: saved.id,
          machine_profile_id: null,
          notes: '',
          sets: [{ set_type: 'working', target_weight_kg: null, target_reps: 10, actual_weight_kg: null, actual_reps: null, completed: false, note: '' }],
        });
        const added = updatedSession.exercises.at(-1);
        if (added) await generateForgeSessionExerciseAdditionCoaching(updatedSession.id, added.id).catch(() => updatedSession);
      }
      if (!editingId && returnTo?.startsWith('/forge/days/')) {
        sessionStorage.setItem('forge-training-day-created-exercise', JSON.stringify({ path: returnTo, exerciseId: saved.id }));
      }
      navigate(returnTo || '/forge/exercises', { replace: true });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Übung konnte nicht gespeichert werden.');
    } finally { setSaving(false); }
  };
  if (loading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin" style={{ color: SAND }} /></div>;
  return <div className="space-y-4 forge-anim"><header className="flex items-start gap-3"><button onClick={() => navigate(returnTo || '/forge/exercises')} className="tap mt-1 flex h-9 w-9 items-center justify-center rounded-full" aria-label="Zurück zur Übungsbibliothek" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><ArrowLeft size={18} /></button><div><p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: SAND }}>Übungsbibliothek</p><h1 className="mt-1 text-[25px] font-semibold" style={{ color: TEXT }}>{editingId ? 'Übung bearbeiten' : 'Neue Übung'}</h1><p className="mt-1 text-[11px]" style={{ color: DIM }}>Bewegung einmal anlegen und in allen Trainingstagen nutzen.</p></div></header>
    {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}
    <section className="card-forge p-4" style={{ borderColor: `${SAND}33` }}><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}><Sparkles size={17} /></span><div><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Mit KI entwerfen</p><h2 className="mt-1 text-[15px] font-semibold" style={{ color: TEXT }}>Beschreibe deine Übung in einem Satz</h2><p className="mt-1 text-[10px]" style={{ color: DIM }}>Die KI füllt Name, Muskelgruppe, Equipment und Icon aus. Du prüfst und speicherst anschließend selbst.</p></div></div><div className="mt-3 flex gap-2"><textarea value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} className="input-forge min-h-11 flex-1 resize-none text-[12px]" rows={2} maxLength={2000} placeholder="z. B. Brustgestützte Rudermaschine für oberen Rücken" /><button onClick={() => void createAiDraft()} disabled={drafting || saving} className="tap flex shrink-0 items-center gap-1.5 rounded-xl px-3 text-[11px] font-medium disabled:opacity-50" style={{ color: '#16130f', background: SAND }}>{drafting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}Entwurf</button></div></section>
    <section className="card-forge space-y-4 p-4"><label className="block"><span className="mb-1.5 block text-[10px] uppercase tracking-wider" style={{ color: DIM }}>Name</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="input-forge w-full" placeholder="z. B. Kabelzug Rudern" /></label><div className="grid grid-cols-[1fr_90px] gap-2"><label><span className="mb-1.5 block text-[10px] uppercase tracking-wider" style={{ color: DIM }}>Primär</span><select value={draft.primary_muscle_group} onChange={(event) => setDraft({ ...draft, primary_muscle_group: event.target.value })} className="input-forge w-full">{MUSCLES.map((muscle) => <option key={muscle}>{muscle}</option>)}</select></label><label><span className="mb-1.5 block text-[10px] uppercase tracking-wider" style={{ color: DIM }}>Icon</span><input value={draft.icon} onChange={(event) => setDraft({ ...draft, icon: event.target.value })} className="input-forge w-full" /></label></div>
      <div><p className="mb-2 text-[10px] uppercase tracking-wider" style={{ color: DIM }}>Equipment</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{EQUIPMENT.map((item) => <button key={item.value} onClick={() => setDraft({ ...draft, equipment: item.value, machine_profile_ids: item.value === 'machine' || item.value === 'cable' ? draft.machine_profile_ids : [] })} className="tap rounded-xl py-2.5 text-[10px]" style={{ color: draft.equipment === item.value ? SAND : DIM, border: `1px solid ${draft.equipment === item.value ? SAND : BORDER}`, background: draft.equipment === item.value ? 'rgba(232,197,138,0.08)' : 'transparent' }}>{item.label}</button>)}</div></div>
      <div><p className="mb-2 text-[10px] uppercase tracking-wider" style={{ color: DIM }}>Sekundäre Muskeln</p><div className="grid grid-cols-2 gap-2">{MUSCLES.filter((item) => item !== draft.primary_muscle_group).map((muscle) => <label key={muscle} className="flex items-center gap-2 rounded-xl px-3 py-2 text-[10px]" style={{ color: draft.secondary_muscle_groups.includes(muscle) ? TEXT : DIM, border: `1px solid ${BORDER}` }}><input type="checkbox" checked={draft.secondary_muscle_groups.includes(muscle)} onChange={() => setDraft({ ...draft, secondary_muscle_groups: draft.secondary_muscle_groups.includes(muscle) ? draft.secondary_muscle_groups.filter((item) => item !== muscle) : [...draft.secondary_muscle_groups, muscle] })} className="accent-[#e8c58a]" />{muscle}</label>)}</div></div>
    </section>
    {machineCapable && <section className="card-forge p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Geräteprofile</p><h2 className="mt-1 text-[15px] font-semibold" style={{ color: TEXT }}>Bestehende Profile zuweisen</h2><p className="mt-1 text-[10px]" style={{ color: DIM }}>Profile bleiben zentral und werden nicht dupliziert.</p></div><button onClick={() => { sessionStorage.setItem(EDITOR_DRAFT_KEY, JSON.stringify({ path: window.location.pathname + window.location.search, draft })); navigate(`/forge/machine-profiles?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`); }} className="tap p-2" style={{ color: SAND }} aria-label="Geräteprofile verwalten"><Settings2 size={17} /></button></div><div className="mt-3 space-y-2">{profiles.map((profile) => { const selected = draft.machine_profile_ids.includes(profile.id); return <label key={profile.id} className="flex items-center gap-3 rounded-xl p-3" style={{ border: `1px solid ${selected ? `${SAND}66` : BORDER}`, background: selected ? 'rgba(232,197,138,0.07)' : 'rgba(255,247,235,0.02)' }}><input type="checkbox" checked={selected} onChange={() => toggleProfile(profile.id)} className="accent-[#e8c58a]" /><span className="min-w-0 flex-1"><span className="block text-[12px] font-medium" style={{ color: TEXT }}>{profile.name}</span><span className="block truncate text-[10px]" style={{ color: DIM }}>{profile.model || 'Ohne Modell'}{profile.notes ? ` · ${profile.notes}` : ''}</span></span>{selected && <Check size={15} style={{ color: SAND }} />}</label>; })}{!profiles.length && <div className="rounded-xl p-4 text-center text-[11px]" style={{ color: DIM, border: `1px dashed ${BORDER}` }}>Noch keine Geräteprofile. Lege zentral das erste an.</div>}</div></section>}
    <button onClick={() => void save()} disabled={saving} className="btn-forge flex w-full items-center justify-center gap-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <><Save size={16} />Übung speichern</>}</button>
  </div>;
}
