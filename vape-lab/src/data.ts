import notes from '../data/notes.json';
import bases from '../data/bases.json';
import synergies from '../data/synergies.json';
import customers from '../data/customers.json';
import wholesale from '../data/wholesale.json';
import { productId } from './sim/id';
import type { GameData, Product } from './sim/types';

export const GAME_DATA: GameData = {
  notes, bases, synergies, customers,
  wholesale: (wholesale as unknown as Omit<Product, 'id'>[]).map((p) => ({ ...p, id: productId(p) }) as Product),
} as unknown as GameData;
