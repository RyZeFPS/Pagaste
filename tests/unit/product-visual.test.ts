import { describe, expect, it } from 'vitest';
import { productThreeDAsset } from '../../src/lib/product-visual';

const item = (
  name: string,
  category: string | null = null,
  source: 'manual' | 'ocr' | 'adjustment' = 'ocr',
) => ({
  name,
  category,
  source,
});

describe('product 3D visuals', () => {
  it.each([
    ['Pizza margarita', 'foodPizza'],
    ['Refresco', 'foodSoda'],
    ['Patatas fritas', 'foodFries'],
    ['Ensalada verde', 'foodSalad'],
    ['Tiramisú', 'foodCake'],
    ['Café', 'foodCoffee'],
    ['Hamburguesa', 'foodBurger'],
    ['Producto desconocido', 'foodGeneric'],
  ] as const)('maps %s to the shared asset %s', (name, asset) => {
    expect(productThreeDAsset(item(name))).toBe(asset);
  });

  it('uses the category when OCR returns a generic product name', () => {
    expect(productThreeDAsset(item('Menú 1', 'pizza'))).toBe('foodPizza');
  });

  it('keeps monetary adjustments as a semantic line icon', () => {
    expect(productThreeDAsset(item('Descuento', null, 'adjustment'))).toBeNull();
  });
});
