/* Small pure helpers shared by preview variants. */

export function sparkPath(
    values: number[],
    w: number,
    h: number,
    pad = 4,
): { line: string; area: string; points: { x: number; y: number }[] } {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;
    const pts = values.map((v, i) => ({
        x: pad + (i / (values.length - 1 || 1)) * innerW,
        y: pad + innerH - ((v - min) / range) * innerH,
    }));
    // smooth cubic
    let line = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const c1x = pts[i].x + (pts[i + 1].x - pts[i].x) * 0.4;
        const c2x = pts[i + 1].x - (pts[i + 1].x - pts[i].x) * 0.4;
        line += ` C ${c1x} ${pts[i].y}, ${c2x} ${pts[i + 1].y}, ${pts[i + 1].x} ${pts[i + 1].y}`;
    }
    const area = `${line} L ${pts[pts.length - 1].x} ${h - pad} L ${pts[0].x} ${h - pad} Z`;
    return { line, area, points: pts };
}

/** circumference + dashoffset for a progress ring */
export function ringMath(radius: number, pct: number) {
    const c = 2 * Math.PI * radius;
    const clamped = Math.max(0, Math.min(1, pct));
    return { c, offset: c * (1 - clamped) };
}

export function greeting(): string {
    const h = new Date().getHours();
    if (h < 11) return 'Guten Morgen';
    if (h < 17) return 'Servus';
    return 'Guten Abend';
}

export function dateLabel(): string {
    return new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}
