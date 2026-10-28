// Pure data types for the Vape Lab simulation. Everything here is plain,
// serialisable JSON so it can be ported to other runtimes.

export const NOTE_ATTRS = ['sweetness', 'tartness', 'cooling', 'richness', 'complexity'] as const;
export type NoteAttr = (typeof NOTE_ATTRS)[number];

export const PROFILE_KEYS = [
  'sweetness', 'tartness', 'cooling', 'richness', 'complexity', 'balance', 'originality',
] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];
export type Profile = Record<ProfileKey, number>;

export const TUNING_KEYS = ['intensity', 'cooling', 'smoothness', 'vapour', 'dependence'] as const;
export type TuningKey = (typeof TUNING_KEYS)[number];
export type Tuning = Record<TuningKey, number>;

export type Family = 'fruit' | 'dessert' | 'candy' | 'beverage' | 'fresh';
export const FAMILIES: Family[] = ['fruit', 'dessert', 'candy', 'beverage', 'fresh'];

export type BaseId = string;
export type NoteId = string;
export type CustomerId = string;
export type SynergyId = string;

export interface NoteDef {
  id: NoteId;
  name: string;
  family: Family;
  colour: string;
  commonness: number;          // 0-100, how often the note shows up on shelves
  cost: number;                // fictional credits per 100 game points
  weights: Record<NoteAttr, number>;
  clashesWith: NoteId[];
}

export interface BaseDef {
  id: BaseId;
  name: string;
  cost: number;
  liquidColour: string;
  offsets: Partial<Profile>;
  appeal: Record<CustomerId, number>;
}

export interface SynergyDef {
  id: SynergyId;
  name: string;
  /** Each entry is one requirement. Alternatives separated by "|".
   *  Tokens: a note id, "base:<id>", or "tag:tart" / "tag:cool". */
  needs: string[];
  bonus: Partial<Profile>;
  hint: string;
}

export interface CustomerTerm {
  stat: string;
  weight: number;
  pivot?: number;
  above?: number;
  below?: number;
  label: string;
}

export interface CustomerDef {
  id: CustomerId;
  name: string;
  avatar: string;
  segment: 'enthusiast' | 'casual';
  baseline: number;
  blurb: string;
  terms: CustomerTerm[];
  comments: Record<string, string[]>;
}

export interface GameData {
  notes: NoteDef[];
  bases: BaseDef[];
  synergies: SynergyDef[];
  customers: CustomerDef[];
}

export type Tier = 'budget' | 'standard' | 'premium';
export const TIERS: Tier[] = ['budget', 'standard', 'premium'];
export const PACK_STYLES = ['classic', 'minimal', 'neon', 'retro', 'luxe'] as const;
export type PackStyle = (typeof PACK_STYLES)[number];
export const LOGOS = ['drop', 'star', 'leaf', 'bolt', 'crown', 'wave', 'heart', 'circle'] as const;
export type Logo = (typeof LOGOS)[number];

export interface NoteSlot {
  noteId: NoteId;
  amount: number;              // 0-100 game points
}

export interface Brand {
  name: string;
  labelColour: string;
  style: PackStyle;
  logo: Logo;
  tier: Tier;
  price: number;               // fictional credits
}

export interface Product {
  id: string;
  base: BaseId;
  notes: NoteSlot[];           // max 4 slots
  tuning: Tuning;
  brand: Brand;
  seed: number;
}

export const MAX_SLOTS = 4;
export const STRONG_NOTE_AMOUNT = 25;

export interface ProfileResult {
  profile: Profile;
  activeSynergies: SynergyId[];
  /** Synergies where every requirement is present but some only faintly. */
  faintSynergies: SynergyId[];
  clashes: [NoteId, NoteId][];
  strongNotes: number;
  familyShare: Record<Family, number>;
}

export interface Driver {
  label: string;
  delta: number;
}

export interface CustomerReaction {
  customerId: CustomerId;
  score: number;
  drivers: Driver[];
  comment: string;
  hintSynergy?: SynergyId;
}

export interface CostBreakdown {
  base: number;
  notes: number;
  tuning: number;
  packaging: number;
  total: number;
}

export interface TestResult {
  productId: string;
  profile: Profile;
  appeal: number;
  originality: number;
  balance: number;
  repeatPurchase: number;
  reputationRisk: number;
  unitCost: CostBreakdown;
  margin: number;
  projectedProfit: number;
  reactions: CustomerReaction[];
  activeSynergies: SynergyId[];
  newlyDiscovered: SynergyId[];
}
