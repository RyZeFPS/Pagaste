import type { ThreeDAsset } from '@/components/three-d-icon';
import type { ExpenseItem } from '@/lib/models';

type ProductVisualInput = Pick<ExpenseItem, 'name' | 'category' | 'source'>;

export function productThreeDAsset(item: ProductVisualInput): ThreeDAsset | null {
  if (item.source === 'adjustment') return null;

  const value = `${item.category ?? ''} ${item.name}`.toLocaleLowerCase('es-ES');
  if (/pizza|focaccia|calzone/u.test(value)) return 'foodPizza';
  if (/patata|frita/u.test(value)) return 'foodFries';
  if (/ensalada|verdura/u.test(value)) return 'foodSalad';
  if (/tiramis|postre|tarta|pastel/u.test(value)) return 'foodCake';
  if (/caf[eé]|espresso/u.test(value)) return 'foodCoffee';
  if (/hamburguesa|burger/u.test(value)) return 'foodBurger';
  if (/refresco|bebida|zumo|cola|soda|cerveza|vino/u.test(value)) return 'foodSoda';
  return 'foodGeneric';
}
