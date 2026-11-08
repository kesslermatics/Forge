export type IconProps = { size?: number; strokeWidth?: number };

/** Lucide has no trousers; these two follow its 24px outline style. */
function SvgIcon({ size = 24, strokeWidth = 2, children }: IconProps & { children: React.ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
export const Pants = (props: IconProps) => <SvgIcon {...props}><path d="M7 3h10l1 18h-4l-2-11-2 11H6L7 3z" /><path d="M7.2 6.5h9.6" /></SvgIcon>;
export const Shorts = (props: IconProps) => <SvgIcon {...props}><path d="M7 4h10l1.5 11h-5L12 10l-1.5 5h-5L7 4z" /><path d="M7.2 7h9.6" /></SvgIcon>;

