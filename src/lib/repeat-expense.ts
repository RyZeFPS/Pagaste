import { AppError } from '@/lib/api-error';
import type { RepeatAllocation } from '@/domain/repeat-expense';
import type { Expense } from '@/lib/models';
import { getSupabase } from '@/lib/supabase/client';

export type RepeatableExpense = Expense & {
  group: { id: string; name: string } | null;
  itemCount: number;
  participantCount: number;
};

type RepeatableExpenseRow = Expense & {
  group: { id: string; name: string } | null;
  expense_items: { count: number }[];
  expense_participants: { count: number }[];
};

type RepeatedExpenseResult = {
  expenseId: string;
  sourceExpenseId: string;
};

type RepeatedItemResult = {
  expenseId: string;
  itemId: string;
  totalCents: number;
};

function throwDatabaseError(error: { code?: string; message: string } | null): void {
  if (error) throw new AppError(error.code ?? 'SERVER_ERROR', error.message);
}

export const repeatExpenseRepository = {
  async list(userId: string): Promise<RepeatableExpense[]> {
    const { data, error } = await getSupabase()
      .from('expenses')
      .select(
        '*, group:groups!expenses_group_id_fkey(id,name), expense_items(count), expense_participants(count)',
      )
      .eq('created_by', userId)
      .in('status', ['sent', 'settled'])
      .order('occurred_at', { ascending: false })
      .limit(20);
    throwDatabaseError(error);
    return ((data ?? []) as unknown as RepeatableExpenseRow[]).map(
      ({ expense_items, expense_participants, ...expense }) => ({
        ...expense,
        itemCount: expense_items[0]?.count ?? 0,
        participantCount: expense_participants[0]?.count ?? 0,
      }),
    );
  },

  async repeat(sourceExpenseId: string): Promise<RepeatedExpenseResult> {
    const { data, error } = await getSupabase().rpc('repeat_expense', {
      p_source_expense_id: sourceExpenseId,
    });
    throwDatabaseError(error);
    if (
      !data ||
      typeof data !== 'object' ||
      typeof (data as Record<string, unknown>).expenseId !== 'string'
    )
      throw new AppError('INVALID_REPEAT_RESPONSE', 'No se ha podido preparar el nuevo gasto.');
    return data as RepeatedExpenseResult;
  },

  async updateItemAmount(input: {
    expenseId: string;
    itemId: string;
    lineTotalCents: number;
    allocations: readonly RepeatAllocation[];
  }): Promise<RepeatedItemResult> {
    const { data, error } = await getSupabase().rpc('update_repeated_expense_item', {
      p_expense_id: input.expenseId,
      p_item_id: input.itemId,
      p_line_total_cents: input.lineTotalCents,
      p_allocations: input.allocations,
    });
    throwDatabaseError(error);
    if (!data || typeof data !== 'object')
      throw new AppError('INVALID_REPEAT_RESPONSE', 'No se ha podido actualizar el producto.');
    return data as RepeatedItemResult;
  },

  async deleteItem(expenseId: string, itemId: string): Promise<RepeatedItemResult> {
    const { data, error } = await getSupabase().rpc('delete_repeated_expense_item', {
      p_expense_id: expenseId,
      p_item_id: itemId,
    });
    throwDatabaseError(error);
    if (!data || typeof data !== 'object')
      throw new AppError('INVALID_REPEAT_RESPONSE', 'No se ha podido eliminar el producto.');
    return data as RepeatedItemResult;
  },
};
