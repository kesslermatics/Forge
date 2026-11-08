import { DIM, TEXT } from '../track/trackUtils';

/** Title row of an overview card with an optional small range chip on the right. */
export default function CardHeader({ title, chip }: { title: string; chip?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: TEXT }}>{title}</h2>
      {chip && <span className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ color: DIM, background: 'rgba(255,247,235,0.06)' }}>{chip}</span>}
    </div>
  );
}
