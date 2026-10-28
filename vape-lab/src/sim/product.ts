import { productId } from './id';
import { DEFAULT_TUNING } from './tuning';
import type { Product } from './types';

export function newProduct(seed = 1): Product {
  const p: Product = {
    id: '',
    base: 'fruity',
    notes: [],
    tuning: { ...DEFAULT_TUNING },
    brand: { name: 'Classic Cloud', format: 'refillable', labelColour: '#3a6df0', style: 'classic', logo: 'drop', tier: 'standard', price: 14 },
    seed,
  };
  p.id = productId(p);
  return p;
}
