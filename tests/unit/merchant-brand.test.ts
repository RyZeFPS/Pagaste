import { describe, expect, it } from 'vitest';
import {
  MERCHANT_BRANDS,
  merchantVisual,
  normalizeMerchantName,
  resolveMerchantBrand,
  searchMerchantBrands,
} from '../../src/lib/merchant-brand';

describe('merchant brand catalogue', () => {
  it('ships a sizeable local catalogue with unique identifiers and aliases', () => {
    expect(MERCHANT_BRANDS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(MERCHANT_BRANDS.map(({ id }) => id)).size).toBe(MERCHANT_BRANDS.length);

    const aliases = MERCHANT_BRANDS.flatMap(({ id, aliases }) =>
      aliases.map((alias) => [alias, id] as const),
    );
    const owners = new Map<string, string>();
    for (const [alias, id] of aliases) {
      expect(alias).toBe(normalizeMerchantName(alias));
      expect(owners.get(alias), `Alias duplicado: ${alias}`).toBeUndefined();
      owners.set(alias, id);
    }
  });

  it('normalizes accents, punctuation, apostrophes and spacing', () => {
    expect(normalizeMerchantName('  McDONALD’S   España, S.L.U. #104 ')).toBe(
      'mcdonalds espana s l u 104',
    );
    expect(normalizeMerchantName('El Corte Inglés & Supercor')).toBe('el corte ingles y supercor');
  });

  it.each([
    ["Restaurante McDonald's España S.L.U. #104", 'mcdonalds'],
    ['El Corte Inglés Pozuelo', 'el-corte-ingles'],
    ['LIDL SUPERMERCADOS S.A.U. 422', 'lidl'],
    ['Supermercado Mercadona 0187', 'mercadona'],
    ['Cepsa Estaciones de Servicio', 'moeve'],
    ['100 Montaditos Sevilla', '100-montaditos'],
    ['Media Markt Iberia', 'mediamarkt'],
    ['Cafetería Starbucks Coffee Madrid', 'starbucks'],
  ])('matches a normalized receipt header %s', (header, expected) => {
    expect(resolveMerchantBrand(header)?.id).toBe(expected);
  });

  it('prefers the most specific prefix when brands share a word', () => {
    expect(resolveMerchantBrand('Uber Eats Madrid')?.id).toBe('uber-eats');
    expect(resolveMerchantBrand('Uber Trip Help')?.id).toBe('uber');
  });

  it('suggests brands from normalized prefixes and contained text', () => {
    expect(searchMerchantBrands('  mÉdia  ')[0]).toMatchObject({
      id: 'mediamarkt',
      displayName: 'MediaMarkt',
      category: 'Tienda',
    });
    expect(searchMerchantBrands('corte').map(({ id }) => id)).toContain('el-corte-ingles');
    expect(searchMerchantBrands('eats')[0]?.id).toBe('uber-eats');
  });

  it('returns official names and never exposes more than six suggestions', () => {
    const mcdonalds = searchMerchantBrands('mcd')[0];
    expect(mcdonalds).toMatchObject({
      id: 'mcdonalds',
      displayName: "McDonald's",
      category: 'Restauración',
    });
    expect(searchMerchantBrands('a', 100)).toHaveLength(6);
    expect(searchMerchantBrands('a', 0)).toEqual([]);
    expect(searchMerchantBrands('   ')).toEqual([]);
  });

  it('does not guess from arbitrary substrings or fuzzy similarities', () => {
    expect(resolveMerchantBrand('La Buena Día Market Cocina')).toBeNull();
    expect(resolveMerchantBrand('Mercado de la Merced')).toBeNull();
    expect(resolveMerchantBrand('Star Coffee Roasters')).toBeNull();
    expect(resolveMerchantBrand(null)).toBeNull();
    expect(resolveMerchantBrand('   ')).toBeNull();
  });

  it('creates a deterministic local fallback for unknown merchants', () => {
    const first = merchantVisual('Pizzería Bella Napoli');
    const repeated = merchantVisual('  Pizzería   Bella Napoli ');

    expect(first).toMatchObject({
      brandId: null,
      displayName: 'Pizzería Bella Napoli',
      monogram: 'PB',
      known: false,
    });
    expect(repeated.backgroundColor).toBe(first.backgroundColor);
    expect(repeated.foregroundColor).toBe(first.foregroundColor);
  });

  it('returns the curated visual when a brand is recognized', () => {
    expect(merchantVisual('Starbucks Coffee Madrid')).toMatchObject({
      brandId: 'starbucks',
      displayName: 'Starbucks',
      monogram: 'S',
      known: true,
    });
  });
});
