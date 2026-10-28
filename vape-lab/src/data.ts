import notes from '../data/notes.json';
import bases from '../data/bases.json';
import synergies from '../data/synergies.json';
import customers from '../data/customers.json';
import type { GameData } from './sim/types';

export const GAME_DATA: GameData = { notes, bases, synergies, customers } as unknown as GameData;
