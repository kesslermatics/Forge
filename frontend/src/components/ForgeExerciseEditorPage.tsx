import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getForgeExercises } from '../api/api';
import type { ForgeExercise } from '../api/api';
import ExerciseFormSheet from './forge/ExerciseFormSheet';

/** Deep-link route for creating or editing an exercise; the form itself is the shared sheet. */
export default function ForgeExerciseEditorPage() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = searchParams.get('returnTo') || '/forge/exercises';
  const [library, setLibrary] = useState<ForgeExercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getForgeExercises().then(setLibrary).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Übungen konnten nicht geladen werden.'));
  }, []);

  if (error) return <div className="card-forge p-6 text-center text-[13px]" style={{ color: '#fca5a5' }}>{error}</div>;
  if (!library) return <div className="flex justify-center py-24"><Loader2 className="animate-spin" style={{ color: '#e8c58a' }} /></div>;
  const exercise = exerciseId && exerciseId !== 'new' ? library.find((item) => item.id === exerciseId) ?? null : null;
  if (exerciseId && exerciseId !== 'new' && !exercise) return <div className="card-forge p-6 text-center text-[13px]" style={{ color: 'rgba(242,236,226,0.5)' }}>Übung nicht gefunden.</div>;

  return <ExerciseFormSheet
    exercise={exercise}
    library={library}
    onClose={() => navigate(returnTo, { replace: true })}
    onSaved={(saved) => navigate(`/forge/exercises/${saved.id}/history`, { replace: true })}
    onUseExisting={(existing) => navigate(`/forge/exercises/${existing.id}/history`, { replace: true })}
  />;
}
