import {
  Car,
  Droplets,
  Flame,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  PawPrint,
  PiggyBank,
  Repeat,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Tag,
  Utensils,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Category } from "./types";

const icons: Record<string, LucideIcon> = {
  tag: Tag,
  home: House,
  groceries: ShoppingBasket,
  transport: Car,
  health: HeartPulse,
  household: PawPrint,
  dining: Utensils,
  hobbies: Gamepad2,
  personal: ShoppingBag,
  gifts: Gift,
  electric: Zap,
  electricity: Zap,
  water: Droplets,
  gas: Flame,
  internet: Wifi,
  phone: Smartphone,
  subscriptions: Repeat,
  insurance: ShieldCheck,
  savings: PiggyBank,
  education: GraduationCap,
};

export const categoryIconOptions = [
  ["auto", "Automatic"],
  ["tag", "General"],
  ["home", "Home"],
  ["groceries", "Groceries"],
  ["transport", "Transportation"],
  ["health", "Health"],
  ["household", "Pets & household"],
  ["dining", "Dining"],
  ["hobbies", "Hobbies"],
  ["personal", "Shopping"],
  ["gifts", "Gifts"],
  ["electric", "Electricity"],
  ["water", "Water"],
  ["gas", "Heating gas"],
  ["internet", "Internet"],
  ["phone", "Phone"],
  ["subscriptions", "Subscriptions"],
  ["insurance", "Insurance"],
  ["savings", "Savings"],
  ["education", "Education"],
] as const;

// Name aliases keep common categories recognizable as category setup expands.
const aliases: [RegExp, LucideIcon][] = [
  [/\b(electric|electricity|power)\b/i, Zap],
  [/\b(water|sewage)\b/i, Droplets],
  [/\b(heating|gas)\b/i, Flame],
  [/\b(internet|broadband)\b/i, Wifi],
  [/\b(phone|mobile)\b/i, Smartphone],
  [/\b(home|house|rent|mortgage)\b/i, House],
  [/\b(groceries|grocery)\b/i, ShoppingBasket],
  [/\b(dining|restaurants)\b/i, Utensils],
  [/\b(pets?|household)\b/i, PawPrint],
];

export function CategoryIcon({
  category,
  size = 18,
  color,
}: {
  category?: Pick<Category, "id" | "name"> & { icon?: string };
  size?: number;
  color?: string;
}) {
  const Icon = category
    ? ((category.icon && category.icon !== "auto"
        ? icons[category.icon]
        : undefined) ??
      icons[category.id] ??
      aliases.find(([pattern]) => pattern.test(category.name))?.[1] ??
      Tag)
    : Tag;
  return (
    <Icon
      size={size}
      color={color}
      strokeWidth={1.7}
      className="category-symbol"
      aria-hidden="true"
    />
  );
}
