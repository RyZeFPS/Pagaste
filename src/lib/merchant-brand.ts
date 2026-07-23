export type MerchantCategory =
  'Supermercado' | 'Restauración' | 'Delivery' | 'Gasolinera' | 'Tienda' | 'Transporte';

export type MerchantBrand = Readonly<{
  id: string;
  displayName: string;
  category: MerchantCategory;
  monogram: string;
  backgroundColor: string;
  foregroundColor: string;
  accentColor?: string;
  aliases: readonly string[];
}>;

export type MerchantVisual = Readonly<{
  brandId: string | null;
  displayName: string;
  monogram: string;
  backgroundColor: string;
  foregroundColor: string;
  accentColor?: string;
  known: boolean;
}>;

export function normalizeMerchantName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLowerCase()
    .replace(/[\u2018\u2019'`\u00b4]/gu, '')
    .replace(/&/gu, ' y ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const CATEGORY_IDS = {
  Supermercado: [
    'mercadona',
    'carrefour',
    'lidl',
    'aldi',
    'dia',
    'alcampo',
    'consum',
    'eroski',
    'el-corte-ingles',
    'hipercor',
    'supercor',
    'bonpreu',
    'caprabo',
    'condis',
    'gadis',
    'froiz',
    'ahorramas',
    'costco',
    'makro',
  ],
  Restauración: [
    'mcdonalds',
    'burger-king',
    'kfc',
    'taco-bell',
    'starbucks',
    'dominos',
    'telepizza',
    'papa-johns',
    '100-montaditos',
    'vips',
    'ginos',
    'fosters-hollywood',
    'rodilla',
    'goiko',
    'five-guys',
  ],
  Delivery: ['glovo', 'uber-eats', 'just-eat'],
  Gasolinera: ['repsol', 'moeve', 'bp', 'shell', 'galp'],
  Tienda: ['ikea', 'primark', 'zara', 'decathlon', 'mediamarkt', 'fnac', 'amazon'],
  Transporte: ['renfe', 'cabify', 'free-now', 'bolt', 'uber'],
} as const satisfies Readonly<Record<MerchantCategory, readonly string[]>>;

function categoryForBrand(id: string): MerchantCategory {
  for (const [category, ids] of Object.entries(CATEGORY_IDS) as [
    MerchantCategory,
    readonly string[],
  ][]) {
    if (ids.includes(id)) return category;
  }
  return 'Tienda';
}

function defineBrand(
  id: string,
  displayName: string,
  monogram: string,
  backgroundColor: string,
  foregroundColor: string,
  aliases: readonly string[],
  accentColor?: string,
): MerchantBrand {
  return Object.freeze({
    id,
    displayName,
    category: categoryForBrand(id),
    monogram,
    backgroundColor,
    foregroundColor,
    ...(accentColor ? { accentColor } : {}),
    aliases: Object.freeze(
      [...new Set([displayName, ...aliases].map(normalizeMerchantName))].filter(Boolean),
    ),
  });
}

/**
 * Curated, local-only merchant catalogue. Rendering stays offline: recognized
 * brands use bundled vector marks or their complete wordmark, while unknown
 * merchants receive a deterministic fallback.
 */
export const MERCHANT_BRANDS: readonly MerchantBrand[] = Object.freeze([
  defineBrand('mercadona', 'Mercadona', 'M', '#E8F7EE', '#007E3A', ['mercadona sa'], '#F4A000'),
  defineBrand(
    'carrefour',
    'Carrefour',
    'C',
    '#EEF4FF',
    '#004E9A',
    ['carrefour express', 'carrefour market'],
    '#E30613',
  ),
  defineBrand(
    'lidl',
    'Lidl',
    'L',
    '#FFF5B8',
    '#004F9F',
    ['lidl supermercados', 'supermercados lidl'],
    '#E30613',
  ),
  defineBrand('aldi', 'ALDI', 'A', '#EAF2FF', '#0050AA', ['aldi supermercados'], '#F5A800'),
  defineBrand('dia', 'DIA', 'DIA', '#FFF0F1', '#D71920', [
    'dia retail',
    'supermercados dia',
    'dia market',
  ]),
  defineBrand('alcampo', 'Alcampo', 'A', '#FFF0F0', '#D71920', [
    'hipermercado alcampo',
    'alcampo supermercado',
  ]),
  defineBrand('consum', 'Consum', 'C', '#FFF3E8', '#EF6C00', ['consum cooperativa'], '#54A832'),
  defineBrand('eroski', 'Eroski', 'E', '#FFF0F0', '#D71920', ['eroski city', 'eroski center']),
  defineBrand('el-corte-ingles', 'El Corte Inglés', 'ECI', '#E9F7EF', '#007A3D', [
    'el corte ingles',
    'centros comerciales el corte ingles',
  ]),
  defineBrand('hipercor', 'Hipercor', 'H', '#E8F7F4', '#007D71', ['hipercor sa']),
  defineBrand('supercor', 'Supercor', 'SC', '#ECF8EE', '#23843A', [
    'supercor expres',
    'supercor express',
  ]),
  defineBrand('bonpreu', 'Bonpreu', 'B', '#FFF0F0', '#C8202F', [
    'bon preu',
    'bonpreu escla',
    'esclat',
  ]),
  defineBrand('caprabo', 'Caprabo', 'C', '#EEF4FF', '#1557A6', ['caprabo sa'], '#E52329'),
  defineBrand(
    'condis',
    'Condis',
    'C',
    '#FFF0F0',
    '#D71920',
    ['condis life', 'condis express'],
    '#1E5AA8',
  ),
  defineBrand('gadis', 'Gadis', 'G', '#EBF7EE', '#168447', ['gadis supermercado']),
  defineBrand('froiz', 'Froiz', 'F', '#FFF0F0', '#D5232A', ['supermercados froiz'], '#23834B'),
  defineBrand('ahorramas', 'Ahorramás', 'A', '#FFF4D6', '#C71920', ['ahorramas', 'ahorra mas']),
  defineBrand('costco', 'Costco', 'C', '#EEF4FF', '#005DAA', ['costco wholesale'], '#E31837'),
  defineBrand('makro', 'Makro', 'M', '#EAF3FF', '#0052A4', ['makro autoservicio'], '#FFCD00'),
  defineBrand('ikea', 'IKEA', 'IKEA', '#0058A3', '#FFDA1A', ['ikea iberica']),
  defineBrand('mcdonalds', "McDonald's", 'M', '#D71920', '#FFC72C', [
    'mcdonalds',
    'restaurante mcdonalds',
    'mcdonalds espana',
  ]),
  defineBrand(
    'burger-king',
    'Burger King',
    'BK',
    '#FFF0D8',
    '#D62300',
    ['burgerking', 'burger king spain'],
    '#F5A623',
  ),
  defineBrand('kfc', 'KFC', 'KFC', '#FFF0F0', '#C8102E', ['kentucky fried chicken']),
  defineBrand('taco-bell', 'Taco Bell', 'TB', '#F4EDFF', '#572C83', ['tacobell'], '#702082'),
  defineBrand('starbucks', 'Starbucks', 'S', '#E8F4EF', '#00754A', ['starbucks coffee']),
  defineBrand(
    'dominos',
    "Domino's",
    'D',
    '#EAF3FF',
    '#006491',
    ['dominos', 'dominos pizza'],
    '#E31837',
  ),
  defineBrand('telepizza', 'Telepizza', 'TP', '#FFF0F0', '#D71920', ['tele pizza']),
  defineBrand(
    'papa-johns',
    'Papa Johns',
    'PJ',
    '#FFF0F0',
    '#C8102E',
    ['papa johns pizza', 'papa johns'],
    '#2E7D32',
  ),
  defineBrand('100-montaditos', '100 Montaditos', '100', '#FFF1E8', '#B52222', [
    'cerveceria 100 montaditos',
  ]),
  defineBrand('vips', 'VIPS', 'V', '#FFF0F0', '#D22630', ['restaurante vips']),
  defineBrand('ginos', 'Ginos', 'G', '#FFF0F0', '#BD1E2D', ['restaurante ginos']),
  defineBrand('fosters-hollywood', "Foster's Hollywood", 'FH', '#2A1713', '#FFD04A', [
    'fosters hollywood',
    'foster hollywood',
  ]),
  defineBrand('rodilla', 'Rodilla', 'R', '#EEF5FF', '#134B8A', ['rodilla sandwich'], '#F4C430'),
  defineBrand('goiko', 'GOIKO', 'G', '#171717', '#FFD23F', ['goiko grill', 'goiko gourmet']),
  defineBrand('five-guys', 'Five Guys', 'FG', '#FFF0F0', '#D71920', ['five guys burgers']),
  defineBrand('glovo', 'Glovo', 'G', '#FFF6CC', '#197A61', ['glovoapp', 'glovo app']),
  defineBrand('uber-eats', 'Uber Eats', 'UE', '#101010', '#52C878', ['ubereats']),
  defineBrand('just-eat', 'Just Eat', 'JE', '#FFF0EA', '#F45D22', ['justeat']),
  defineBrand(
    'repsol',
    'Repsol',
    'R',
    '#FFF0E8',
    '#F26A21',
    ['repsol comercial', 'estacion repsol'],
    '#E52A34',
  ),
  defineBrand(
    'moeve',
    'Moeve',
    'M',
    '#EAF8F7',
    '#007F78',
    ['cepsa', 'cepsa estaciones', 'estacion cepsa'],
    '#7A3E9D',
  ),
  defineBrand(
    'bp',
    'bp',
    'bp',
    '#EDF8E8',
    '#237C35',
    ['bp oil', 'bp connect', 'estacion bp'],
    '#F5D328',
  ),
  defineBrand(
    'shell',
    'Shell',
    'S',
    '#FFF4CC',
    '#D71920',
    ['shell espana', 'estacion shell'],
    '#F9C900',
  ),
  defineBrand('galp', 'Galp', 'G', '#FFF1E8', '#E65300', ['galp energia', 'estacion galp']),
  defineBrand('primark', 'Primark', 'P', '#EAF8FF', '#0088C2', ['primark tienda']),
  defineBrand('zara', 'Zara', 'Z', '#F1F1F1', '#111111', ['zara espana']),
  defineBrand('decathlon', 'Decathlon', 'D', '#EAF4FF', '#0066B3', ['decathlon espana']),
  defineBrand('mediamarkt', 'MediaMarkt', 'MM', '#FFF0F0', '#DF0000', [
    'media markt',
    'mediamarkt iberia',
  ]),
  defineBrand('fnac', 'Fnac', 'fnac', '#FFF3E5', '#F58220', ['fnac espana']),
  defineBrand(
    'amazon',
    'Amazon',
    'A',
    '#EEF1F4',
    '#182534',
    ['amazon eu', 'amazon marketplace'],
    '#FF9900',
  ),
  defineBrand('renfe', 'Renfe', 'R', '#F5EDF7', '#7B2B83', ['renfe viajeros']),
  defineBrand('cabify', 'Cabify', 'C', '#F3EEFF', '#7145D6', ['cabify espana']),
  defineBrand('free-now', 'FREENOW', 'FN', '#FFF0F1', '#E21B3C', ['free now', 'mytaxi']),
  defineBrand('bolt', 'Bolt', 'B', '#E9F8F1', '#2F8B67', ['bolt ride', 'bolt taxi']),
  defineBrand('uber', 'Uber', 'U', '#101010', '#FFFFFF', ['uber bv', 'uber trip']),
]);

function suggestionScore(brand: MerchantBrand, query: string): number {
  const displayName = normalizeMerchantName(brand.displayName);
  let score = 0;

  if (displayName === query) score = 50_000;
  else if (displayName.startsWith(query)) score = 40_000 - displayName.length;
  else if (displayName.includes(query)) score = 20_000 - displayName.indexOf(query);

  for (const alias of brand.aliases) {
    if (alias === query) score = Math.max(score, 45_000);
    else if (alias.startsWith(query)) score = Math.max(score, 35_000 - alias.length);
    else if (alias.includes(query)) score = Math.max(score, 10_000 - alias.indexOf(query));
  }

  return score;
}

/**
 * Search helper for the explicit merchant picker. Unlike OCR matching below,
 * suggestions may match contained text because the user is actively choosing
 * a result. Results are always local, stable and capped at six.
 */
export function searchMerchantBrands(
  value: string | null | undefined,
  limit = 6,
): readonly MerchantBrand[] {
  const query = normalizeMerchantName(value ?? '');
  if (!query) return [];

  const safeLimit = Math.max(0, Math.min(6, Math.trunc(limit)));
  if (!safeLimit) return [];

  return MERCHANT_BRANDS.map((brand) => ({ brand, score: suggestionScore(brand, query) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.brand.id.localeCompare(right.brand.id))
    .slice(0, safeLimit)
    .map(({ brand }) => brand);
}

const GENERIC_PREFIXES = [
  'estacion de servicio',
  'estacion servicio',
  'centro comercial',
  'hamburgueseria',
  'supermercados',
  'supermercado',
  'hipermercado',
  'restaurante',
  'cafeteria',
  'pizzeria',
  'gasolinera',
  'cerveceria',
  'tienda',
] as const;

function candidateNames(normalized: string): string[] {
  const candidates = [normalized];
  let candidate = normalized;
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of GENERIC_PREFIXES) {
      if (candidate.startsWith(`${prefix} `)) {
        candidate = candidate.slice(prefix.length + 1).trim();
        if (candidate) candidates.push(candidate);
        changed = true;
        break;
      }
    }
  }
  return [...new Set(candidates)];
}

function aliasScore(candidate: string, alias: string): number {
  if (candidate === alias) return 20_000 + alias.length;
  if (candidate.startsWith(`${alias} `)) return 10_000 + alias.length;
  return 0;
}

export function resolveMerchantBrand(value: string | null | undefined): MerchantBrand | null {
  if (!value?.trim()) return null;
  const candidates = candidateNames(normalizeMerchantName(value));
  let best: { brand: MerchantBrand; score: number } | null = null;
  let ambiguous = false;

  for (const brand of MERCHANT_BRANDS) {
    let score = 0;
    for (const candidate of candidates) {
      for (const alias of brand.aliases) score = Math.max(score, aliasScore(candidate, alias));
    }
    if (!score) continue;
    if (!best || score > best.score) {
      best = { brand, score };
      ambiguous = false;
    } else if (score === best.score && best.brand.id !== brand.id) {
      ambiguous = true;
    }
  }

  return ambiguous ? null : (best?.brand ?? null);
}

const FALLBACK_PALETTES = [
  ['#EAF2FF', '#174EA6', '#76A7FA'],
  ['#E9F8F1', '#087A55', '#65C7A3'],
  ['#FFF2E8', '#A94B08', '#F2A15F'],
  ['#F4EDFF', '#6941C6', '#A78BFA'],
  ['#FDEDEE', '#B42318', '#F08A8E'],
  ['#E8F7F7', '#0E6670', '#67BBC3'],
] as const;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fallbackMonogram(value: string): string {
  const ignored = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y']);
  const words = normalizeMerchantName(value)
    .split(' ')
    .filter((word) => word && !ignored.has(word));
  if (!words.length) return '€';
  if (words.length > 1) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  return Array.from(words[0]!).slice(0, 2).join('').toUpperCase();
}

export function merchantVisual(
  merchantName: string | null | undefined,
  fallbackLabel = 'Comercio',
): MerchantVisual {
  const brand = resolveMerchantBrand(merchantName);
  if (brand) {
    return {
      brandId: brand.id,
      displayName: brand.displayName,
      monogram: brand.monogram,
      backgroundColor: brand.backgroundColor,
      foregroundColor: brand.foregroundColor,
      accentColor: brand.accentColor,
      known: true,
    };
  }

  const label = merchantName?.trim() || fallbackLabel.trim() || 'Comercio';
  const normalized = normalizeMerchantName(label) || 'comercio';
  const palette = FALLBACK_PALETTES[stableHash(normalized) % FALLBACK_PALETTES.length]!;
  return {
    brandId: null,
    displayName: label,
    monogram: fallbackMonogram(label),
    backgroundColor: palette[0],
    foregroundColor: palette[1],
    accentColor: palette[2],
    known: false,
  };
}
