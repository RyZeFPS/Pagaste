import type {
  Cents,
  ExpenseAdjustment,
  ExpenseLineAllocation,
  ExpenseTotalsInput,
  ExpenseValidationError,
  ExpenseValidationErrorCode,
  ExpenseValidationResult,
  MemberAmount,
  MemberLineTotal,
  MemberTotal,
} from '../types';
import { DomainValidationError } from './errors';
import { assertSafeCents, isSafeCents, sumCents } from './money';

type AllocatedEntry = ExpenseLineAllocation | ExpenseAdjustment;

function isAdjustment(entry: AllocatedEntry): entry is ExpenseAdjustment {
  return 'kind' in entry;
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizedId(value: string, label: string): string {
  const result = normalizeText(value);
  if (result.length === 0) {
    throw new DomainValidationError('invalid_id', `${label} must not be empty`);
  }
  return result;
}

function memberAmount(total: MemberTotal | MemberAmount): Cents {
  return 'amountCents' in total ? total.amountCents : total.totalCents;
}

export function calculateMemberTotals(
  entries: readonly AllocatedEntry[],
  participantIds: readonly string[] = [],
): MemberTotal[] {
  const totals = new Map<string, { totalCents: Cents; breakdown: MemberLineTotal[] }>();

  for (const [index, participantId] of participantIds.entries()) {
    const id = normalizedId(participantId, `participantIds[${index}]`);
    if (totals.has(id)) {
      throw new DomainValidationError('duplicate_member', `Member ${id} appears more than once`);
    }
    totals.set(id, { totalCents: 0, breakdown: [] });
  }

  for (const [entryIndex, entry] of entries.entries()) {
    const lineId = normalizedId(entry.id, `entries[${entryIndex}].id`);
    const lineName = normalizeText(entry.name) || 'Sin nombre';
    for (const [allocationIndex, allocation] of entry.allocations.entries()) {
      const memberId = normalizedId(
        allocation.memberId,
        `entries[${entryIndex}].allocations[${allocationIndex}].memberId`,
      );
      assertSafeCents(
        allocation.amountCents,
        `entries[${entryIndex}].allocations[${allocationIndex}].amountCents`,
      );
      const current = totals.get(memberId) ?? { totalCents: 0, breakdown: [] };
      current.totalCents = sumCents(
        [current.totalCents, allocation.amountCents],
        `total for ${memberId}`,
      );
      current.breakdown.push({
        lineId,
        lineName,
        amountCents: allocation.amountCents,
        kind: isAdjustment(entry) ? entry.kind : 'line',
      });
      totals.set(memberId, current);
    }
  }

  return Array.from(totals, ([memberId, total]) => ({
    memberId,
    totalCents: total.totalCents,
    breakdown: total.breakdown,
  }));
}

export function memberTotalsToRecord(
  memberTotals: readonly MemberTotal[],
): Readonly<Record<string, Cents>> {
  const result: Record<string, Cents> = {};
  for (const [index, total] of memberTotals.entries()) {
    const memberId = normalizedId(total.memberId, `memberTotals[${index}].memberId`);
    if (Object.prototype.hasOwnProperty.call(result, memberId)) {
      throw new DomainValidationError(
        'duplicate_member',
        `Member ${memberId} appears more than once`,
      );
    }
    assertSafeCents(total.totalCents, `total for ${memberId}`);
    result[memberId] = total.totalCents;
  }
  return result;
}

export function calculateRecoverableAmount(
  memberTotals: readonly MemberTotal[] | readonly MemberAmount[],
  payerId: string,
): Cents {
  const normalizedPayerId = normalizedId(payerId, 'payerId');
  const recoverable: Cents[] = [];
  for (const [index, total] of memberTotals.entries()) {
    const memberId = normalizedId(total.memberId, `memberTotals[${index}].memberId`);
    const amount = memberAmount(total);
    assertSafeCents(amount, `memberTotals[${index}]`);
    if (memberId !== normalizedPayerId) recoverable.push(amount);
  }
  return sumCents(recoverable, 'recoverable amount');
}

function pushError(
  errors: ExpenseValidationError[],
  code: ExpenseValidationErrorCode,
  message: string,
  details: Omit<ExpenseValidationError, 'code' | 'message'> = {},
): void {
  errors.push({ code, message, ...details });
}

function normalizeIdentifierList(
  values: readonly string[],
  duplicateCode: ExpenseValidationErrorCode,
  path: string,
  errors: ExpenseValidationError[],
): Set<string> {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const normalized = normalizeText(value);
    if (normalized.length === 0) {
      pushError(errors, 'invalid_id', 'El identificador no puede estar vacío', {
        path: `${path}.${index}`,
      });
      return;
    }
    if (seen.has(normalized)) {
      pushError(errors, duplicateCode, `${normalized} aparece más de una vez`, {
        path: `${path}.${index}`,
      });
    }
    seen.add(normalized);
  });
  return seen;
}

function safeAmount(value: unknown, path: string, errors: ExpenseValidationError[]): Cents {
  if (!isSafeCents(value)) {
    pushError(
      errors,
      'invalid_amount',
      'El importe debe ser un entero seguro expresado en céntimos',
      { path },
    );
    return 0;
  }
  return value;
}

function safeDifference(
  expected: Cents,
  actual: Cents,
  path: string,
  errors: ExpenseValidationError[],
): Cents {
  const difference = BigInt(expected) - BigInt(actual);
  if (
    difference > BigInt(Number.MAX_SAFE_INTEGER) ||
    difference < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    pushError(errors, 'invalid_amount', 'La diferencia supera el rango monetario seguro', {
      path,
    });
    return 0;
  }
  return Number(difference);
}

function allocationDirectionMatches(amount: Cents, expected: Cents): boolean {
  if (expected > 0) return amount >= 0;
  if (expected < 0) return amount <= 0;
  return amount === 0;
}

function isUnderallocated(difference: Cents, expected: Cents): boolean {
  if (expected > 0) return difference > 0;
  if (expected < 0) return difference < 0;
  return false;
}

function validateAdjustmentDirection(
  adjustment: ExpenseAdjustment,
  amountCents: Cents,
  prefix: string,
  errors: ExpenseValidationError[],
): void {
  const shouldBeNegative = adjustment.kind === 'discount';
  const shouldBePositive = ['tip', 'tax', 'fee'].includes(adjustment.kind);
  if ((shouldBeNegative && amountCents > 0) || (shouldBePositive && amountCents < 0)) {
    pushError(
      errors,
      'invalid_adjustment_direction',
      shouldBeNegative
        ? 'Un descuento no puede aumentar el total'
        : 'Este ajuste no puede reducir el total',
      { path: `${prefix}.amountCents`, lineId: adjustment.id },
    );
  }
}

function validateAllocatedEntry(
  entry: AllocatedEntry,
  index: number,
  participantIds: ReadonlySet<string> | null,
  expenseCurrency: string,
  errors: ExpenseValidationError[],
): AllocatedEntry {
  const adjustment = isAdjustment(entry);
  const prefix = adjustment ? `adjustments.${index}` : `lines.${index}`;
  const amountPath = adjustment ? `${prefix}.amountCents` : `${prefix}.lineTotalCents`;
  const expectedAmount = safeAmount(
    adjustment ? entry.amountCents : entry.lineTotalCents,
    amountPath,
    errors,
  );
  const id = normalizeText(entry.id);
  const name = normalizeText(entry.name);

  if (id.length === 0) {
    pushError(errors, 'invalid_id', 'La línea necesita un identificador', {
      path: `${prefix}.id`,
    });
  }
  if (name.length === 0) {
    pushError(errors, 'invalid_name', 'La línea necesita un nombre', {
      path: `${prefix}.name`,
      lineId: id,
    });
  }
  if (!adjustment && expectedAmount < 0) {
    pushError(errors, 'invalid_amount', 'El importe de un producto no puede ser negativo', {
      path: amountPath,
      lineId: id,
    });
  }
  if (adjustment) validateAdjustmentDirection(entry, expectedAmount, prefix, errors);

  const normalizedCurrency = entry.currency?.trim().toUpperCase();
  if (normalizedCurrency !== undefined && normalizedCurrency !== expenseCurrency) {
    pushError(errors, 'currency_mismatch', 'No se pueden mezclar monedas dentro de un gasto', {
      path: `${prefix}.currency`,
      lineId: id,
    });
  }

  if (entry.allocations.length === 0 && expectedAmount !== 0) {
    pushError(errors, 'empty_allocations', 'La línea debe asignarse al menos a una persona', {
      path: `${prefix}.allocations`,
      lineId: id,
    });
  }
  normalizeIdentifierList(
    entry.allocations.map(({ memberId }) => memberId),
    'duplicate_allocation',
    `${prefix}.allocations`,
    errors,
  );

  const allocations = entry.allocations.map((allocation, allocationIndex) => {
    const memberId = normalizeText(allocation.memberId);
    const amountCents = safeAmount(
      allocation.amountCents,
      `${prefix}.allocations.${allocationIndex}.amountCents`,
      errors,
    );
    if (memberId.length > 0 && participantIds !== null && !participantIds.has(memberId)) {
      pushError(
        errors,
        'unknown_participant',
        'La asignación pertenece a un participante que ya no existe',
        {
          path: `${prefix}.allocations.${allocationIndex}.memberId`,
          memberId,
          lineId: id,
        },
      );
    }
    if (!allocationDirectionMatches(amountCents, expectedAmount)) {
      pushError(
        errors,
        'invalid_allocation_direction',
        'La asignación debe tener el mismo signo que el importe de la línea',
        {
          path: `${prefix}.allocations.${allocationIndex}.amountCents`,
          memberId,
          lineId: id,
        },
      );
    }
    return { memberId, amountCents };
  });

  let allocatedAmount: Cents = 0;
  try {
    allocatedAmount = sumCents(
      allocations.map(({ amountCents }) => amountCents),
      `${prefix}.allocations`,
    );
  } catch (error: unknown) {
    pushError(
      errors,
      'invalid_amount',
      error instanceof Error ? error.message : 'La suma no es segura',
      { path: `${prefix}.allocations` },
    );
  }

  if (allocatedAmount !== expectedAmount) {
    const difference = safeDifference(
      expectedAmount,
      allocatedAmount,
      `${prefix}.allocations`,
      errors,
    );
    const underallocated = isUnderallocated(difference, expectedAmount);
    pushError(
      errors,
      adjustment
        ? underallocated
          ? 'adjustment_unassigned'
          : 'adjustment_overallocated'
        : underallocated
          ? 'line_unassigned'
          : 'line_overallocated',
      underallocated
        ? 'El importe no está asignado por completo'
        : 'Las asignaciones superan el importe',
      {
        path: `${prefix}.allocations`,
        differenceCents: difference,
        lineId: id,
      },
    );
  }

  if (adjustment) {
    return {
      ...entry,
      id,
      name,
      currency: normalizedCurrency,
      amountCents: expectedAmount,
      allocations,
    };
  }
  return {
    ...entry,
    id,
    name,
    currency: normalizedCurrency,
    lineTotalCents: expectedAmount,
    allocations,
  };
}

function amountMap(amounts: readonly MemberAmount[]): Map<string, Cents> {
  const result = new Map<string, Cents>();
  for (const { memberId, amountCents } of amounts) {
    const normalizedMemberId = normalizeText(memberId);
    result.set(
      normalizedMemberId,
      sumCents(
        [result.get(normalizedMemberId) ?? 0, amountCents],
        `claim for ${normalizedMemberId}`,
      ),
    );
  }
  return result;
}

export function validateExpenseTotals(input: ExpenseTotalsInput): ExpenseValidationResult {
  const errors: ExpenseValidationError[] = [];
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    pushError(errors, 'invalid_currency', 'La moneda debe ser un código ISO 4217 de tres letras', {
      path: 'currency',
    });
  }

  const totalCents = safeAmount(input.totalCents, 'totalCents', errors);
  if (totalCents < 0) {
    pushError(errors, 'invalid_amount', 'El total del gasto no puede ser negativo', {
      path: 'totalCents',
    });
  }

  const payerId = normalizeText(input.payerId);
  if (payerId.length === 0) {
    pushError(errors, 'invalid_id', 'El pagador necesita un identificador', {
      path: 'payerId',
    });
  }

  const participantSet = input.participantIds
    ? normalizeIdentifierList(
        input.participantIds,
        'duplicate_participant',
        'participantIds',
        errors,
      )
    : null;
  if (participantSet !== null && payerId.length > 0 && !participantSet.has(payerId)) {
    pushError(errors, 'payer_not_participant', 'El pagador debe formar parte del gasto', {
      path: 'payerId',
      memberId: payerId,
    });
  }

  if (input.lines.length === 0) {
    pushError(errors, 'empty_lines', 'El gasto debe contener al menos una línea', {
      path: 'lines',
    });
  }
  normalizeIdentifierList(
    input.lines.map(({ id }) => id),
    'duplicate_line',
    'lines',
    errors,
  );
  normalizeIdentifierList(
    (input.adjustments ?? []).map(({ id }) => id),
    'duplicate_adjustment',
    'adjustments',
    errors,
  );

  const lines = input.lines.map(
    (line, index) =>
      validateAllocatedEntry(
        line,
        index,
        participantSet,
        currency,
        errors,
      ) as ExpenseLineAllocation,
  );
  const adjustments = (input.adjustments ?? []).map(
    (adjustment, index) =>
      validateAllocatedEntry(
        adjustment,
        index,
        participantSet,
        currency,
        errors,
      ) as ExpenseAdjustment,
  );

  let lineTotalCents: Cents = 0;
  let adjustmentTotalCents: Cents = 0;
  try {
    lineTotalCents = sumCents(
      lines.map(({ lineTotalCents: amount }) => amount),
      'line total',
    );
    adjustmentTotalCents = sumCents(
      adjustments.map(({ amountCents }) => amountCents),
      'adjustment total',
    );
  } catch (error: unknown) {
    pushError(
      errors,
      'invalid_amount',
      error instanceof Error ? error.message : 'La suma no es segura',
      { path: 'totalCents' },
    );
  }

  let calculatedTotalCents: Cents = 0;
  try {
    calculatedTotalCents = sumCents(
      [lineTotalCents, adjustmentTotalCents],
      'calculated expense total',
    );
  } catch (error: unknown) {
    pushError(
      errors,
      'invalid_amount',
      error instanceof Error ? error.message : 'La suma no es segura',
      { path: 'totalCents' },
    );
  }

  const differenceCents = safeDifference(totalCents, calculatedTotalCents, 'totalCents', errors);
  if (calculatedTotalCents !== totalCents) {
    pushError(
      errors,
      'expense_total_mismatch',
      'La suma de líneas y ajustes no coincide con el total del ticket',
      { path: 'totalCents', differenceCents },
    );
  }

  let memberTotals: MemberTotal[] = [];
  let recoverableAmountCents: Cents = 0;
  try {
    memberTotals = calculateMemberTotals([...lines, ...adjustments], input.participantIds ?? []);
    for (const total of memberTotals) {
      if (total.totalCents < 0) {
        pushError(
          errors,
          'negative_member_total',
          'La parte total de una persona no puede ser negativa',
          { path: 'lines', memberId: total.memberId },
        );
      }
    }
    recoverableAmountCents = calculateRecoverableAmount(memberTotals, payerId);
  } catch (error: unknown) {
    pushError(
      errors,
      'invalid_amount',
      error instanceof Error ? error.message : 'No se pudieron calcular los totales',
      { path: 'lines' },
    );
  }

  let claimTotalCents: Cents | null = null;
  if (input.claimAmounts !== undefined) {
    const cleanClaims = input.claimAmounts.map((claim, index) => {
      const amountCents = safeAmount(
        claim.amountCents,
        `claimAmounts.${index}.amountCents`,
        errors,
      );
      if (amountCents <= 0) {
        pushError(errors, 'invalid_amount', 'Cada cobro debe tener un importe positivo', {
          path: `claimAmounts.${index}.amountCents`,
          memberId: claim.memberId,
        });
      }
      return { memberId: normalizeText(claim.memberId), amountCents };
    });
    normalizeIdentifierList(
      cleanClaims.map(({ memberId }) => memberId),
      'duplicate_claim',
      'claimAmounts',
      errors,
    );

    for (const [index, claim] of cleanClaims.entries()) {
      if (claim.memberId === payerId) {
        pushError(errors, 'claim_for_payer', 'No se debe crear un cobro contra el propio pagador', {
          path: `claimAmounts.${index}`,
          memberId: claim.memberId,
        });
      }
      if (
        claim.memberId.length > 0 &&
        participantSet !== null &&
        !participantSet.has(claim.memberId)
      ) {
        pushError(
          errors,
          'unknown_participant',
          'El cobro pertenece a un participante que ya no existe',
          {
            path: `claimAmounts.${index}.memberId`,
            memberId: claim.memberId,
          },
        );
      }
    }

    try {
      claimTotalCents = sumCents(
        cleanClaims
          .filter(({ memberId }) => memberId !== payerId)
          .map(({ amountCents }) => amountCents),
        'claim total',
      );
    } catch (error: unknown) {
      pushError(
        errors,
        'invalid_amount',
        error instanceof Error ? error.message : 'La suma de cobros no es segura',
        { path: 'claimAmounts' },
      );
      claimTotalCents = 0;
    }

    if (claimTotalCents !== recoverableAmountCents) {
      pushError(
        errors,
        'claim_total_mismatch',
        'La suma de cobros no coincide con el importe recuperable',
        {
          path: 'claimAmounts',
          differenceCents: safeDifference(
            recoverableAmountCents,
            claimTotalCents,
            'claimAmounts',
            errors,
          ),
        },
      );
    }

    const calculatedByMember = amountMap(
      memberTotals
        .filter(({ memberId }) => memberId !== payerId)
        .map(({ memberId, totalCents: amountCents }) => ({ memberId, amountCents })),
    );
    const claimedByMember = amountMap(cleanClaims.filter(({ memberId }) => memberId !== payerId));
    const relevantMembers = new Set([...calculatedByMember.keys(), ...claimedByMember.keys()]);
    for (const memberId of relevantMembers) {
      const calculated = calculatedByMember.get(memberId) ?? 0;
      const claimed = claimedByMember.get(memberId) ?? 0;
      if (calculated !== claimed) {
        pushError(
          errors,
          'claim_member_mismatch',
          'El cobro individual no coincide con la parte calculada',
          {
            path: 'claimAmounts',
            differenceCents: safeDifference(calculated, claimed, 'claimAmounts', errors),
            memberId,
          },
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    lineTotalCents,
    adjustmentTotalCents,
    calculatedTotalCents,
    differenceCents,
    memberTotals,
    recoverableAmountCents,
    claimTotalCents,
  };
}
