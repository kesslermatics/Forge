import { Hammer } from 'lucide-react';

type Props = { size?: 'sm' | 'lg' };

export default function ForgeIcon({ size = 'sm' }: Props) {
    const box = size === 'lg' ? 64 : 32;
    const radius = size === 'lg' ? 16 : 9;
    const iconSize = size === 'lg' ? 30 : 16;

    return (
        <div style={{
            width: box,
            height: box,
            borderRadius: radius,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            background: 'linear-gradient(145deg, rgba(232,197,138,0.22), rgba(180,140,80,0.12))',
            border: '1px solid rgba(232,197,138,0.32)',
        }}>
            <Hammer size={iconSize} color="#e8c58a" strokeWidth={1.75} />
        </div>
    );
}
