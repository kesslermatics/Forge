import type { ComponentType } from 'react';
import { Backpack, Footprints, Glasses, Headphones, KeyRound, Shirt, Smartphone, Wallet, Watch } from 'lucide-react';
import { Pants, Shorts, type IconProps } from './ClothingGlyphs';

export type ClothingIconKey = 'shirt' | 'pants' | 'shorts' | 'phone' | 'shoes' | 'watch' | 'wallet' | 'keys' | 'glasses' | 'backpack' | 'headphones';

export const CLOTHING_ICONS: Record<ClothingIconKey, { label: string; Icon: ComponentType<IconProps> }> = {
  shirt: { label: 'Hemd', Icon: Shirt },
  pants: { label: 'Hose', Icon: Pants },
  shorts: { label: 'Shorts', Icon: Shorts },
  phone: { label: 'Handy', Icon: Smartphone },
  shoes: { label: 'Schuhe', Icon: Footprints },
  watch: { label: 'Uhr', Icon: Watch },
  wallet: { label: 'Geldbeutel', Icon: Wallet },
  keys: { label: 'Schlüssel', Icon: KeyRound },
  glasses: { label: 'Brille', Icon: Glasses },
  backpack: { label: 'Rucksack', Icon: Backpack },
  headphones: { label: 'Kopfhörer', Icon: Headphones },
};

export const CLOTHING_ICON_KEYS = Object.keys(CLOTHING_ICONS) as ClothingIconKey[];
