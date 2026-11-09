import {
  Banknote, BookOpen, Briefcase, Car, CircleHelp, CirclePlus, Coffee, CreditCard, Droplets, Dumbbell, Flame, Fuel, Gamepad2, Gift,
  GraduationCap, Hammer, HeartPulse, House, Landmark, Music, PawPrint, Phone, PiggyBank, Pill, Plane, Repeat, Shield, Shirt,
  ShoppingBasket, Sofa, Sparkles, Tv, Utensils, Wallet, Wifi, Zap, type LucideIcon,
} from "lucide-react";

/** Icons a category can use. The stored value is the key. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  home: House, zap: Zap, flame: Flame, droplets: Droplets, wifi: Wifi, phone: Phone, shield: Shield,
  "shopping-basket": ShoppingBasket, car: Car, fuel: Fuel, "heart-pulse": HeartPulse, pill: Pill, landmark: Landmark,
  "credit-card": CreditCard, "graduation-cap": GraduationCap, briefcase: Briefcase, "paw-print": PawPrint, dumbbell: Dumbbell,
  utensils: Utensils, coffee: Coffee, "gamepad-2": Gamepad2, repeat: Repeat, tv: Tv, music: Music, "book-open": BookOpen,
  gift: Gift, sparkles: Sparkles, shirt: Shirt, plane: Plane, hammer: Hammer, sofa: Sofa, "piggy-bank": PiggyBank,
  wallet: Wallet, banknote: Banknote, "plus-circle": CirclePlus, "circle-help": CircleHelp,
};

export function CategoryIcon({ name, size = 16 }: { name: string | null; size?: number }) {
  const Glyph = (name && CATEGORY_ICONS[name]) || Wallet;
  return <Glyph size={size} aria-hidden="true" />;
}
