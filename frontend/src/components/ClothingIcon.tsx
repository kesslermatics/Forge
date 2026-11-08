import { CLOTHING_ICONS, type ClothingIconKey } from './clothingIcons';

export default function ClothingIcon({ icon, size = 20 }: { icon: string; size?: number }) {
  const { Icon } = CLOTHING_ICONS[icon as ClothingIconKey] ?? CLOTHING_ICONS.shirt;
  return <Icon size={size} />;
}
