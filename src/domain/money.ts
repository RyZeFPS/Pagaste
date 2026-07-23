import type {
  AllocationTarget,
  Cents,
  CustomAllocationTarget,
  MemberAmount,
  PercentageAllocationTarget,
  RemainderAllocation,
  ShareAllocationTarget,
  UnitAllocationTarget,
} from '../types';
import { DomainValidationError } from './errors';

export const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;
export const MIN_SAFE_CENTS = Number.MIN_SAFE_INTEGER;

type TargetInput = string | AllocationTarget;

interface NormalizedTarget {
  memberId: string;
  selectionOrder: number;
  inputIndex: number;
}

interface WeightedTarget extends NormalizedTarget {
  weight: bigint;
}

export function isSafeCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertSafeCents(value: unknown, label = 'amountCents'): asserts value is Cents {
  if (!isSafeCents(value)) {
    throw new DomainValidationError(
      'invalid_cents',
      `${label} must be an integer between Number.MIN_SAFE_INTEGER and Number.MAX_SAFE_INTEGER`,
    );
  }
}

export function sumCents(values: readonly Cents[], label = 'sum'): Cents {
  const total = values.reduce((sum, value, index) => {
    assertSafeCents(value, `${label}[${index}]`);
    return sum + BigInt(value);
  }, 0n);

  return bigintToCents(total, label);
}

function bigintToCents(value: bigint, label: string): Cents {
  const maximum = BigInt(MAX_SAFE_CENTS);
  const minimum = BigInt(MIN_SAFE_CENTS);
  if (value > maximum || value < minimum) {
    throw new DomainValidationError('unsafe_cents', `${label} exceeds the safe client cents range`);
  }
  return Number(value);
}

function normalizeMemberId(memberId: string, label: string): string {
  const normalized = memberId.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError('invalid_member', `${label} must not be empty`);
  }
  return normalized;
}

function normalizeTargets(targets: readonly TargetInput[]): NormalizedTarget[] {
  if (targets.length === 0) {
    throw new DomainValidationError('empty_allocation', 'At least one member is required');
  }

  const normalized = targets.map((target, inputIndex) => {
    const memberId = normalizeMemberId(
      typeof target === 'string' ? target : target.memberId,
      `members[${inputIndex}].memberId`,
    );
    const selectionOrder =
      typeof target === 'string' ? inputIndex : (target.selectionOrder ?? inputIndex);
    if (!Number.isSafeInteger(selectionOrder) || selectionOrder < 0) {
      throw new DomainValidationError(
        'invalid_selection_order',
        `members[${inputIndex}].selectionOrder must be a non-negative safe integer`,
      );
    }
    return { memberId, selectionOrder, inputIndex };
  });

  const memberIds = new Set<string>();
  for (const target of normalized) {
    if (memberIds.has(target.memberId)) {
      throw new DomainValidationError(
        'duplicate_member',
        `Member ${target.memberId} appears more than once`,
      );
    }
    memberIds.add(target.memberId);
  }
  return normalized;
}

function stableTargetIndexes(targets: readonly NormalizedTarget[]): number[] {
  return targets
    .map((target, index) => ({ target, index }))
    .sort(
      (left, right) =>
        left.target.selectionOrder - right.target.selectionOrder ||
        left.target.memberId.localeCompare(right.target.memberId),
    )
    .map(({ index }) => index);
}

function distributeMemberRemainder(
  totalCents: Cents,
  allocations: readonly RemainderAllocation[],
): MemberAmount[] {
  assertSafeCents(totalCents, 'totalCents');
  if (allocations.length === 0) {
    if (totalCents === 0) return [];
    throw new DomainValidationError('empty_allocation', 'Cannot distribute cents without members');
  }

  const targets = normalizeTargets(allocations);
  const amounts = allocations.map((allocation, index) => {
    assertSafeCents(allocation.amountCents, `allocations[${index}].amountCents`);
    return BigInt(allocation.amountCents);
  });
  const currentTotal = amounts.reduce((sum, amount) => sum + amount, 0n);
  const difference = BigInt(totalCents) - currentTotal;
  if (difference === 0n) {
    return targets.map((target, index) => ({
      memberId: target.memberId,
      amountCents: allocations[index].amountCents,
    }));
  }

  const direction = difference > 0n ? 1n : -1n;
  const absoluteDifference = difference > 0n ? difference : -difference;
  const memberCount = BigInt(allocations.length);
  const amountForEveryMember = absoluteDifference / memberCount;
  const remaining = Number(absoluteDifference % memberCount);

  if (amountForEveryMember > 0n) {
    for (let index = 0; index < amounts.length; index += 1) {
      amounts[index] += direction * amountForEveryMember;
    }
  }

  const stableIndexes = stableTargetIndexes(targets);
  for (let index = 0; index < remaining; index += 1) {
    amounts[stableIndexes[index]] += direction;
  }

  return targets.map((target, index) => ({
    memberId: target.memberId,
    amountCents: bigintToCents(amounts[index], `allocation for ${target.memberId}`),
  }));
}

export function distributeRemainderCents(
  totalCents: Cents,
  allocations: readonly RemainderAllocation[],
): MemberAmount[];
export function distributeRemainderCents(allocations: readonly Cents[], totalCents: Cents): Cents[];
export function distributeRemainderCents(
  first: Cents | readonly Cents[],
  second: Cents | readonly RemainderAllocation[],
): MemberAmount[] | Cents[] {
  if (typeof first !== 'number') {
    if (typeof second !== 'number') {
      throw new DomainValidationError('invalid_allocation', 'A numeric target total is required');
    }
    const result = distributeMemberRemainder(
      second,
      first.map((amountCents, index) => ({
        memberId: String(index),
        amountCents,
        selectionOrder: index,
      })),
    );
    return result.map(({ amountCents }) => amountCents);
  }
  if (!Array.isArray(second)) {
    throw new DomainValidationError('invalid_allocation', 'Member allocations are required');
  }
  return distributeMemberRemainder(first, second);
}

function splitWeighted(totalCents: Cents, targets: readonly WeightedTarget[]): MemberAmount[] {
  assertSafeCents(totalCents, 'totalCents');
  if (targets.length === 0) {
    throw new DomainValidationError('empty_allocation', 'At least one member is required');
  }
  const totalWeight = targets.reduce((sum, target) => sum + target.weight, 0n);
  if (totalWeight <= 0n) {
    throw new DomainValidationError(
      'invalid_weight',
      'The sum of weights must be greater than zero',
    );
  }

  const sign = totalCents < 0 ? -1n : 1n;
  const absoluteTotal = BigInt(totalCents < 0 ? -totalCents : totalCents);
  const baseAmounts: bigint[] = [];
  const residues: bigint[] = [];

  for (const target of targets) {
    const weightedAmount = absoluteTotal * target.weight;
    baseAmounts.push(weightedAmount / totalWeight);
    residues.push(weightedAmount % totalWeight);
  }

  const allocated = baseAmounts.reduce((sum, amount) => sum + amount, 0n);
  const remainderCount = Number(absoluteTotal - allocated);
  const remainderOrder = targets
    .map((target, index) => ({ target, index, residue: residues[index] }))
    .sort(
      (left, right) =>
        (left.residue === right.residue ? 0 : left.residue > right.residue ? -1 : 1) ||
        left.target.selectionOrder - right.target.selectionOrder ||
        left.target.memberId.localeCompare(right.target.memberId),
    );

  for (let index = 0; index < remainderCount; index += 1) {
    baseAmounts[remainderOrder[index].index] += 1n;
  }

  return targets.map((target, index) => ({
    memberId: target.memberId,
    amountCents: bigintToCents(sign * baseAmounts[index], `allocation for ${target.memberId}`),
  }));
}

function targetsFromCount(count: number): NormalizedTarget[] {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new DomainValidationError(
      'invalid_member_count',
      'Member count must be a positive safe integer',
    );
  }
  return normalizeTargets(Array.from({ length: count }, (_, index) => String(index)));
}

export function splitEvenly(totalCents: Cents, memberCount: number): Cents[];
export function splitEvenly(totalCents: Cents, members: readonly TargetInput[]): MemberAmount[];
export function splitEvenly(
  totalCents: Cents,
  members: number | readonly TargetInput[],
): MemberAmount[] | Cents[] {
  const numericResult = typeof members === 'number';
  const targets = numericResult ? targetsFromCount(members) : normalizeTargets(members);
  const result = splitWeighted(
    totalCents,
    targets.map((target) => ({ ...target, weight: 1n })),
  );
  return numericResult ? result.map(({ amountCents }) => amountCents) : result;
}

function normalizeWeightedRecord(values: Readonly<Record<string, number>>): {
  memberId: string;
  value: number;
}[] {
  return Object.entries(values).map(([memberId, value]) => ({ memberId, value }));
}

function normalizeSafeWeights(
  inputs:
    | readonly number[]
    | readonly (ShareAllocationTarget | UnitAllocationTarget)[]
    | Readonly<Record<string, number>>,
  field: 'shares' | 'units',
  allowZero: boolean,
): { targets: WeightedTarget[]; numericResult: boolean } {
  const numericResult =
    Array.isArray(inputs) && (inputs.length === 0 || typeof inputs[0] === 'number');
  let records: (AllocationTarget & { value: number })[];
  if (Array.isArray(inputs)) {
    if (numericResult) {
      records = (inputs as readonly number[]).map((value, index) => ({
        memberId: String(index),
        value,
      }));
    } else {
      records = (inputs as readonly (ShareAllocationTarget | UnitAllocationTarget)[]).map(
        (input, index) => {
          const value =
            field === 'shares'
              ? 'shares' in input
                ? input.shares
                : Number.NaN
              : 'units' in input
                ? input.units
                : Number.NaN;
          if (!Number.isFinite(value)) {
            throw new DomainValidationError(
              `invalid_${field}`,
              `${field}[${index}] does not contain a ${field} value`,
            );
          }
          return {
            memberId: input.memberId,
            selectionOrder: input.selectionOrder,
            value,
          };
        },
      );
    }
  } else {
    records = normalizeWeightedRecord(inputs as Readonly<Record<string, number>>).map(
      ({ memberId, value }) => ({ memberId, value }),
    );
  }
  const targets = normalizeTargets(records);
  return {
    numericResult,
    targets: targets.map((target, index) => {
      const value = records[index].value;
      const valid = Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
      if (!valid) {
        throw new DomainValidationError(
          `invalid_${field}`,
          `${field}[${index}] must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer`,
        );
      }
      return { ...target, weight: BigInt(value) };
    }),
  };
}

export function splitByShares(totalCents: Cents, shares: readonly number[]): Cents[];
export function splitByShares(
  totalCents: Cents,
  shares: readonly ShareAllocationTarget[] | Readonly<Record<string, number>>,
): MemberAmount[];
export function splitByShares(
  totalCents: Cents,
  shares: readonly number[] | readonly ShareAllocationTarget[] | Readonly<Record<string, number>>,
): Cents[] | MemberAmount[] {
  const { targets, numericResult } = normalizeSafeWeights(shares, 'shares', false);
  const result = splitWeighted(totalCents, targets);
  return numericResult ? result.map(({ amountCents }) => amountCents) : result;
}

export function splitByUnits(totalCents: Cents, units: readonly number[]): Cents[];
export function splitByUnits(
  totalCents: Cents,
  units: readonly UnitAllocationTarget[] | Readonly<Record<string, number>>,
): MemberAmount[];
export function splitByUnits(
  totalCents: Cents,
  units: readonly number[] | readonly UnitAllocationTarget[] | Readonly<Record<string, number>>,
): Cents[] | MemberAmount[] {
  const { targets, numericResult } = normalizeSafeWeights(units, 'units', true);
  const result = splitWeighted(totalCents, targets);
  return numericResult ? result.map(({ amountCents }) => amountCents) : result;
}

interface ParsedDecimal {
  integer: bigint;
  decimalPlaces: number;
}

function parsePercentage(value: number | string, label: string): ParsedDecimal {
  const source = typeof value === 'number' ? String(value) : value.trim().replace(',', '.');
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new DomainValidationError('invalid_percentage', `${label} must be finite`);
  }
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(source);
  if (!match) {
    throw new DomainValidationError(
      'invalid_percentage',
      `${label} must be a non-negative decimal with at most 6 decimal places`,
    );
  }
  const decimals = match[2] ?? '';
  return {
    integer: BigInt(`${match[1]}${decimals}`),
    decimalPlaces: decimals.length,
  };
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

type PercentageInput =
  | readonly (number | string)[]
  | readonly PercentageAllocationTarget[]
  | Readonly<Record<string, number | string>>;

export function splitByPercentages(
  totalCents: Cents,
  percentages: readonly (number | string)[],
): Cents[];
export function splitByPercentages(
  totalCents: Cents,
  percentages: readonly PercentageAllocationTarget[] | Readonly<Record<string, number | string>>,
): MemberAmount[];
export function splitByPercentages(
  totalCents: Cents,
  percentages: PercentageInput,
): Cents[] | MemberAmount[] {
  const numericResult =
    Array.isArray(percentages) &&
    (percentages.length === 0 ||
      typeof percentages[0] === 'number' ||
      typeof percentages[0] === 'string');
  const records: (AllocationTarget & { percentage: number | string })[] = Array.isArray(percentages)
    ? numericResult
      ? (percentages as readonly (number | string)[]).map((percentage, index) => ({
          memberId: String(index),
          percentage,
        }))
      : (percentages as readonly PercentageAllocationTarget[]).map((input) => ({ ...input }))
    : Object.entries(percentages).map(([memberId, percentage]) => ({ memberId, percentage }));
  const targets = normalizeTargets(records);
  const parsed = records.map((record, index) =>
    parsePercentage(record.percentage, `percentages[${index}]`),
  );
  const decimalPlaces = parsed.reduce(
    (maximum, percentage) => Math.max(maximum, percentage.decimalPlaces),
    0,
  );
  const scaled = parsed.map(
    (percentage) => percentage.integer * powerOfTen(decimalPlaces - percentage.decimalPlaces),
  );
  const expected = 100n * powerOfTen(decimalPlaces);
  if (scaled.reduce((sum, percentage) => sum + percentage, 0n) !== expected) {
    throw new DomainValidationError('percentage_total', 'Percentages must add up to exactly 100');
  }
  const result = splitWeighted(
    totalCents,
    targets.map((target, index) => ({ ...target, weight: scaled[index] })),
  );
  return numericResult ? result.map(({ amountCents }) => amountCents) : result;
}

type CustomInput =
  readonly Cents[] | readonly CustomAllocationTarget[] | Readonly<Record<string, Cents>>;

export function splitByCustomAmounts(totalCents: Cents, amounts: readonly Cents[]): Cents[];
export function splitByCustomAmounts(
  totalCents: Cents,
  amounts: readonly CustomAllocationTarget[] | Readonly<Record<string, Cents>>,
): MemberAmount[];
export function splitByCustomAmounts(
  totalCents: Cents,
  amounts: CustomInput,
): Cents[] | MemberAmount[] {
  assertSafeCents(totalCents, 'totalCents');
  const numericResult =
    Array.isArray(amounts) && (amounts.length === 0 || typeof amounts[0] === 'number');
  const records: CustomAllocationTarget[] = Array.isArray(amounts)
    ? numericResult
      ? (amounts as readonly Cents[]).map((amountCents, index) => ({
          memberId: String(index),
          amountCents,
        }))
      : (amounts as readonly CustomAllocationTarget[]).map((input) => ({ ...input }))
    : Object.entries(amounts).map(([memberId, amountCents]) => ({ memberId, amountCents }));
  const targets = normalizeTargets(records);
  const result = records.map((record, index) => {
    assertSafeCents(record.amountCents, `amounts[${index}].amountCents`);
    if (totalCents > 0 && record.amountCents < 0) {
      throw new DomainValidationError(
        'invalid_custom_amount',
        'A positive line cannot have a negative allocation',
      );
    }
    if (totalCents < 0 && record.amountCents > 0) {
      throw new DomainValidationError(
        'invalid_custom_amount',
        'A negative adjustment cannot have a positive allocation',
      );
    }
    if (totalCents === 0 && record.amountCents !== 0) {
      throw new DomainValidationError(
        'invalid_custom_amount',
        'A zero line can only have zero allocations',
      );
    }
    return { memberId: targets[index].memberId, amountCents: record.amountCents };
  });
  if (
    sumCents(
      result.map(({ amountCents }) => amountCents),
      'custom allocation total',
    ) !== totalCents
  ) {
    throw new DomainValidationError('custom_total', 'Custom amounts must add up to the line total');
  }
  return numericResult ? result.map(({ amountCents }) => amountCents) : result;
}

export const validateCustomAmounts = splitByCustomAmounts;
