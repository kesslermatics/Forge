import { useEffect, useState } from 'react';
import { fetchForgePlanImage } from '../api/api';
import type { ForgePlan } from '../api/api';

const FALLBACK_BACKGROUND = 'rgba(255,247,235,0.045)';

export default function ForgePlanImagePreview({ plan, className }: { plan: ForgePlan; className: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!plan.has_image) { setImageUrl(null); return; }
    let disposed = false;
    let objectUrl: string | null = null;
    setImageUrl(null);
    void fetchForgePlanImage(plan.id).then((blob) => {
      const createdUrl = URL.createObjectURL(blob);
      objectUrl = createdUrl;
      if (disposed) URL.revokeObjectURL(createdUrl);
      else setImageUrl(createdUrl);
    }).catch(() => {
      if (!disposed) setImageUrl(null);
    });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [plan.id, plan.has_image]);

  if (!imageUrl) return null;
  return <div className={`shrink-0 overflow-hidden rounded-xl ${className}`} style={{ background: FALLBACK_BACKGROUND }}>
    <img src={imageUrl} alt={`Bild für ${plan.name}`} className="h-full w-full object-contain" />
  </div>;
}
