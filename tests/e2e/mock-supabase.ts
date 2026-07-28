import type { Page, Route } from '@playwright/test';

const NOW = '2026-07-22T10:00:00.000Z';

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  expense: '22222222-2222-4222-8222-222222222222',
  payer: '33333333-3333-4333-8333-333333333333',
  guest: '44444444-4444-4444-8444-444444444444',
  item: '55555555-5555-4555-8555-555555555555',
  item2: '55555555-5555-4555-8555-555555555556',
  payerAllocation: '66666666-6666-4666-8666-666666666666',
  guestAllocation: '77777777-7777-4777-8777-777777777777',
  claim: '88888888-8888-4888-8888-888888888888',
  group: '99999999-9999-4999-8999-999999999999',
} as const;

type JsonRecord = Record<string, unknown>;

type Expense = JsonRecord & {
  id: string;
  title: string;
  merchant_name: string | null;
  currency: string;
  total_cents: number;
  status: string;
};

type Participant = JsonRecord & {
  id: string;
  display_name: string;
  is_payer: boolean;
};

type Item = JsonRecord & {
  id: string;
  name: string;
  line_total_cents: number;
};

type Allocation = JsonRecord & {
  id: string;
  item_id: string;
  participant_id: string;
  amount_cents: number;
};

type Claim = JsonRecord & {
  id: string;
  expense_id: string;
  debtor_participant_id: string;
  amount_cents: number;
  status: string;
};

export type MockSupabase = {
  profile: JsonRecord;
  expense: Expense | null;
  participants: Participant[];
  items: Item[];
  allocations: Allocation[];
  claims: Claim[];
  unhandledRequests: string[];
};

function baseExpense(): Expense {
  return {
    id: ids.expense,
    group_id: null,
    created_by: ids.user,
    payer_member_id: null,
    payer_participant_id: ids.payer,
    title: 'Cena del viernes',
    merchant_name: 'Pizzería Bella Napoli',
    occurred_at: NOW,
    currency: 'EUR',
    total_cents: 4_000,
    recoverable_cents: 2_000,
    own_share_cents: 2_000,
    receipt_path: null,
    status: 'sent',
    scan_status: 'idle',
    notes: null,
    created_at: NOW,
  };
}

function baseParticipants(): Participant[] {
  return [
    {
      id: ids.payer,
      expense_id: ids.expense,
      user_id: ids.user,
      display_name: 'Alex',
      avatar_path: null,
      email: null,
      phone_e164: null,
      is_payer: true,
      sort_order: 0,
    },
    {
      id: ids.guest,
      expense_id: ids.expense,
      user_id: null,
      display_name: 'Ferran',
      avatar_path: null,
      email: null,
      phone_e164: null,
      is_payer: false,
      sort_order: 1,
    },
  ];
}

function withDebtor(claim: Claim, participants: Participant[], expense: Expense | null): Claim {
  const debtor = participants.find(({ id }) => id === claim.debtor_participant_id);
  return {
    ...claim,
    debtor: debtor
      ? { id: debtor.id, display_name: debtor.display_name, avatar_path: debtor.avatar_path }
      : null,
    expense: expense
      ? {
          id: expense.id,
          title: expense.title,
          merchant_name: expense.merchant_name,
          occurred_at: expense.occurred_at,
          currency: expense.currency,
        }
      : null,
  };
}

export function createMockSupabase(seedClaim = false): MockSupabase {
  const participants = seedClaim ? baseParticipants() : [];
  return {
    profile: {
      id: ids.user,
      display_name: 'Alex',
      avatar_path: null,
      email: 'alex@example.com',
      default_currency: 'EUR',
      locale: 'es-ES',
      timezone: 'Europe/Madrid',
      notifications_enabled: true,
      payment_phone_e164: null,
      share_payment_phone: false,
      onboarding_completed: true,
      created_at: NOW,
    },
    expense: seedClaim ? baseExpense() : null,
    participants,
    items: seedClaim
      ? [
          {
            id: ids.item,
            expense_id: ids.expense,
            name: 'Cena',
            quantity: 1,
            unit_price_cents: 4_000,
            line_total_cents: 4_000,
            category: null,
            sort_order: 0,
            ocr_confidence: null,
            source: 'manual',
          },
        ]
      : [],
    allocations: seedClaim
      ? [
          {
            id: ids.payerAllocation,
            item_id: ids.item,
            participant_id: ids.payer,
            method: 'equal',
            shares: null,
            percentage: null,
            units: null,
            amount_cents: 2_000,
          },
          {
            id: ids.guestAllocation,
            item_id: ids.item,
            participant_id: ids.guest,
            method: 'equal',
            shares: null,
            percentage: null,
            units: null,
            amount_cents: 2_000,
          },
        ]
      : [],
    claims: seedClaim
      ? [
          {
            id: ids.claim,
            expense_id: ids.expense,
            debtor_participant_id: ids.guest,
            creditor_participant_id: ids.payer,
            amount_cents: 2_000,
            status: 'pending',
            sent_at: NOW,
            viewed_at: null,
            received_at: null,
            received_by_user_id: null,
            last_reminded_at: null,
            reminder_count: 0,
          },
        ]
      : [],
    unhandledRequests: [],
  };
}

function corsHeaders(route: Route): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers':
      route.request().headers()['access-control-request-headers'] ??
      'authorization,apikey,content-type,prefer,x-client-info',
    'access-control-expose-headers': 'content-range',
  };
}

async function json(route: Route, value: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: corsHeaders(route),
    body: JSON.stringify(value),
  });
}

function requestBody(route: Route): JsonRecord {
  const data = route.request().postDataJSON() as JsonRecord | JsonRecord[] | null;
  return (Array.isArray(data) ? data[0] : data) ?? {};
}

function requestArray(route: Route): JsonRecord[] {
  const data = route.request().postDataJSON() as JsonRecord | JsonRecord[] | null;
  return Array.isArray(data) ? data : data ? [data] : [];
}

function sessionResponse() {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: ids.user,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'alex@example.com',
      exp: Math.floor(Date.now() / 1_000) + 3_600,
    }),
  ).toString('base64url');
  const accessToken = `${header}.${payload}.signature`;
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3_600,
    expires_at: Math.floor(Date.now() / 1_000) + 3_600,
    refresh_token: 'e2e-refresh-token',
    user: {
      id: ids.user,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'alex@example.com',
      email_confirmed_at: NOW,
      phone: '',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { name: 'Alex' },
      identities: [],
      created_at: NOW,
      updated_at: NOW,
      is_anonymous: false,
    },
  };
}

function publicClaim(state: MockSupabase) {
  const claim = state.claims[0];
  const expense = state.expense ?? baseExpense();
  const guestAllocation = state.allocations.find(
    ({ participant_id }) => participant_id === claim?.debtor_participant_id,
  );
  const item = state.items.find(({ id }) => id === guestAllocation?.item_id);
  return {
    creditorDisplayName: String(state.profile.display_name ?? 'Alex'),
    creditorAvatarUrl: null,
    creditorPhoneE164:
      state.profile.share_payment_phone === true
        ? (state.profile.payment_phone_e164 as string | null)
        : null,
    expenseTitle: expense.title,
    merchantName: expense.merchant_name,
    occurredAt: expense.occurred_at,
    currency: expense.currency,
    amountCents: claim?.amount_cents ?? 2_000,
    originalAmountCents: claim?.amount_cents ?? 2_000,
    offsetAmountCents: 0,
    status: claim?.status ?? 'pending',
    paymentProgress: {
      totalCents: claim?.amount_cents ?? 2_000,
      settledCents: claim?.status === 'received' ? (claim.amount_cents ?? 2_000) : 0,
      pendingCents: claim?.status === 'received' ? 0 : (claim?.amount_cents ?? 2_000),
      completed: claim?.status === 'received',
      payers: [
        {
          displayName: 'Invitado',
          amountCents: claim?.amount_cents ?? 2_000,
          settledCents: claim?.status === 'received' ? (claim.amount_cents ?? 2_000) : 0,
          status: claim?.status ?? 'pending',
          isCurrent: true,
        },
      ],
    },
    items:
      item && guestAllocation
        ? [
            {
              name: item.name,
              originalLineTotalCents: item.line_total_cents,
              assignedAmountCents: guestAllocation.amount_cents,
              allocationLabel: 'A partes iguales',
            },
          ]
        : [],
    canDispute: claim ? ['pending', 'reminder_sent'].includes(claim.status) : true,
  };
}

async function handleAuth(route: Route): Promise<void> {
  const { pathname } = new URL(route.request().url());
  if (pathname.endsWith('/signup')) {
    const session = sessionResponse();
    await json(route, { user: session.user, session: null });
    return;
  }
  if (pathname.endsWith('/recover')) {
    await json(route, {});
    return;
  }
  if (pathname.endsWith('/verify')) {
    await json(route, sessionResponse());
    return;
  }
  if (pathname.endsWith('/token')) {
    await json(route, sessionResponse());
    return;
  }
  if (pathname.endsWith('/user')) {
    await json(route, { user: sessionResponse().user });
    return;
  }
  if (pathname.endsWith('/logout')) {
    await json(route, {});
    return;
  }
  await json(route, { message: `Unhandled auth route: ${pathname}` }, 404);
}

async function handleRest(route: Route, state: MockSupabase): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const table = url.pathname.split('/').at(-1);
  const method = request.method();

  if (table === 'get_reputation_card' && method === 'POST') {
    return json(route, {
      userId: ids.user,
      score: 88,
      level: 'reliable',
      completedPayments: 12,
      within24Rate: 92,
      medianPaymentHours: 5.5,
      averageReminders: 0.2,
      isOwn: true,
    });
  }

  if (table === 'get_reputation_cards' && method === 'POST') {
    const requested = (requestBody(route).p_user_ids as string[] | undefined) ?? [];
    return json(
      route,
      Object.fromEntries(
        requested.map((userId) => [
          userId,
          {
            userId,
            score: 88,
            level: 'reliable',
            completedPayments: 12,
            within24Rate: userId === ids.user ? 92 : null,
            medianPaymentHours: userId === ids.user ? 5.5 : null,
            averageReminders: userId === ids.user ? 0.2 : null,
            isOwn: userId === ids.user,
          },
        ]),
      ),
    );
  }

  if (table === 'get_group_streak' && method === 'POST') {
    return json(route, {
      groupId: ids.group,
      currentStreak: 3,
      longestStreak: 5,
      completedRounds: 8,
      successfulRounds: 7,
      within24Rate: 88,
      hasOverdue: false,
      activeClaims: 1,
      nextDeadline: new Date(Date.now() + 7_200_000).toISOString(),
    });
  }

  if (table === 'get_group_member_debts' && method === 'POST') {
    return json(route, [
      {
        group_member_id: ids.user,
        user_id: ids.user,
        amount_cents: 0,
        currency: 'EUR',
      },
    ]);
  }

  if (table === 'profiles') {
    if (method === 'GET') return json(route, state.profile);
    if (method === 'POST' || method === 'PATCH') {
      state.profile = { ...state.profile, ...requestBody(route) };
      return json(route, state.profile, method === 'POST' ? 201 : 200);
    }
  }

  if (table === 'expenses') {
    if (method === 'POST') {
      state.expense = {
        ...baseExpense(),
        ...requestBody(route),
        id: ids.expense,
        payer_participant_id: null,
      };
      return json(route, state.expense, 201);
    }
    if (method === 'PATCH' && state.expense) {
      state.expense = { ...state.expense, ...requestBody(route) };
      return json(route, state.expense);
    }
    if (method === 'GET') {
      const single = url.searchParams.has('id');
      return json(route, single ? state.expense : state.expense ? [state.expense] : []);
    }
  }

  if (table === 'expense_participants') {
    if (method === 'POST') {
      const body = requestBody(route);
      const payer = body.is_payer === true;
      const participant: Participant = {
        id: payer ? ids.payer : ids.guest,
        expense_id: String(body.expense_id),
        user_id: body.user_id == null ? null : String(body.user_id),
        display_name: String(body.display_name),
        avatar_path: null,
        email: null,
        phone_e164: null,
        is_payer: payer,
        sort_order: Number(body.sort_order ?? state.participants.length),
      };
      state.participants.push(participant);
      if (payer && state.expense) state.expense.payer_participant_id = participant.id;
      return json(route, participant, 201);
    }
    if (method === 'GET') return json(route, state.participants);
    if (method === 'DELETE') {
      const selectedId = url.searchParams.get('id')?.replace('eq.', '');
      state.participants = state.participants.filter(({ id }) => id !== selectedId);
      return route.fulfill({ status: 204, headers: corsHeaders(route), body: '' });
    }
  }

  if (table === 'expense_items') {
    if (method === 'POST') {
      const body = requestBody(route);
      const item: Item = {
        id: state.items.length === 0 ? ids.item : ids.item2,
        expense_id: String(body.expense_id),
        name: String(body.name),
        quantity: Number(body.quantity ?? 1),
        unit_price_cents: body.unit_price_cents == null ? null : Number(body.unit_price_cents),
        line_total_cents: Number(body.line_total_cents),
        category: body.category == null ? null : String(body.category),
        sort_order: Number(body.sort_order ?? state.items.length),
        ocr_confidence: null,
        source: String(body.source ?? 'manual'),
      };
      state.items.push(item);
      return json(route, item, 201);
    }
    if (method === 'GET') return json(route, state.items);
    if (method === 'PATCH') {
      const selectedId = url.searchParams.get('id')?.replace('eq.', '');
      const index = state.items.findIndex(({ id }) => id === selectedId);
      state.items[index] = { ...state.items[index], ...requestBody(route) };
      return json(route, state.items[index]);
    }
    if (method === 'DELETE') {
      const selectedId = url.searchParams.get('id')?.replace('eq.', '');
      state.items = state.items.filter(({ id }) => id !== selectedId);
      state.allocations = state.allocations.filter(({ item_id }) => item_id !== selectedId);
      return route.fulfill({ status: 204, headers: corsHeaders(route), body: '' });
    }
  }

  if (table === 'item_allocations') {
    if (method === 'GET') return json(route, state.allocations);
    if (method === 'DELETE') {
      const itemId = url.searchParams.get('item_id')?.replace('eq.', '');
      state.allocations = state.allocations.filter(({ item_id }) => item_id !== itemId);
      return route.fulfill({ status: 204, headers: corsHeaders(route), body: '' });
    }
    if (method === 'POST') {
      const allocations = requestArray(route);
      const respectsDatabaseConstraint = allocations.every((allocation) => {
        const allocationMethod = String(allocation.method);
        const hasShares = allocation.shares != null;
        const hasPercentage = allocation.percentage != null;
        const hasUnits = allocation.units != null;

        if (allocationMethod === 'shares') return hasShares && !hasPercentage && !hasUnits;
        if (allocationMethod === 'percentage') return !hasShares && hasPercentage && !hasUnits;
        if (allocationMethod === 'units') return !hasShares && !hasPercentage && hasUnits;
        return (
          ['equal', 'custom'].includes(allocationMethod) &&
          !hasShares &&
          !hasPercentage &&
          !hasUnits
        );
      });
      if (!respectsDatabaseConstraint) {
        return json(
          route,
          {
            code: '23514',
            message:
              'new row for relation "item_allocations" violates check constraint "item_allocations_check"',
          },
          400,
        );
      }
      state.allocations.push(
        ...allocations.map((allocation, index): Allocation => ({
          id: index === 0 ? ids.payerAllocation : ids.guestAllocation,
          item_id: String(allocation.item_id),
          participant_id: String(allocation.participant_id),
          method: String(allocation.method),
          shares: allocation.shares == null ? null : Number(allocation.shares),
          percentage: allocation.percentage == null ? null : Number(allocation.percentage),
          units: allocation.units == null ? null : Number(allocation.units),
          amount_cents: Number(allocation.amount_cents),
        })),
      );
      return route.fulfill({ status: 201, headers: corsHeaders(route), body: '' });
    }
  }

  if (table === 'claims' && method === 'GET') {
    return json(
      route,
      state.claims.map((claim) => withDebtor(claim, state.participants, state.expense)),
    );
  }

  if (table === 'app_notifications' && (method === 'GET' || method === 'HEAD')) {
    return route.fulfill({
      status: 200,
      headers: { ...corsHeaders(route), 'content-range': '*/0' },
      body: method === 'HEAD' ? '' : '[]',
    });
  }

  if (table === 'groups' && method === 'GET') return json(route, []);

  state.unhandledRequests.push(`${method} ${url.pathname}${url.search}`);
  await json(route, { message: `Unhandled REST request: ${method} ${table}` }, 501);
}

async function handleFunction(route: Route, state: MockSupabase): Promise<void> {
  const request = route.request();
  const functionName = new URL(request.url()).pathname.split('/').at(-1);

  if (functionName === 'create-claim-links') {
    const input = requestBody(route);
    const debtor = state.participants.find((participant) => !participant.is_payer);
    const creditor = state.participants.find((participant) => participant.is_payer);
    if (!debtor || !creditor) {
      await json(
        route,
        {
          data: null,
          error: { code: 'NO_SETTLEMENTS_REQUIRED', message: 'No settlement required' },
        },
        409,
      );
      return;
    }
    const amountCents = state.allocations
      .filter((allocation) => allocation.participant_id === debtor.id)
      .reduce((total, allocation) => total + allocation.amount_cents, 0);
    const claim: Claim = {
      id: ids.claim,
      expense_id: String(input.expenseId),
      debtor_participant_id: debtor.id,
      creditor_participant_id: creditor.id,
      amount_cents: amountCents,
      status: 'pending',
      sent_at: NOW,
      viewed_at: null,
      received_at: null,
      received_by_user_id: null,
      last_reminded_at: null,
      reminder_count: 0,
    };
    state.claims = [claim];
    if (state.expense) state.expense.status = 'sent';
    await json(route, {
      data: {
        claims: [
          {
            claimId: ids.claim,
            debtorParticipantId: claim.debtor_participant_id,
            creditorParticipantId: claim.creditor_participant_id,
            amountCents: claim.amount_cents,
            url: 'http://127.0.0.1:8081/c/e2e-public-token',
          },
        ],
      },
      error: null,
    });
    return;
  }

  if (functionName === 'get-public-claim') {
    const claim = state.claims[0];
    if (claim && claim.viewed_at == null) claim.viewed_at = NOW;
    await json(route, { data: publicClaim(state), error: null });
    return;
  }

  if (functionName === 'mark-claim-received') {
    const claim = state.claims[0];
    if (claim) {
      claim.status = 'received';
      claim.received_at = NOW;
      claim.received_by_user_id = ids.user;
    }
    await json(route, {
      data: { claimId: ids.claim, status: 'received', receivedAt: NOW },
      error: null,
    });
    return;
  }

  if (functionName === 'dispute-claim') {
    const claim = state.claims[0];
    if (claim) claim.status = 'disputed';
    await json(route, { data: { status: 'disputed', createdAt: NOW }, error: null });
    return;
  }

  if (functionName === 'send-reminder') {
    const claim = state.claims[0];
    if (claim) {
      claim.status = 'reminder_sent';
      claim.last_reminded_at = NOW;
      claim.reminder_count = Number(claim.reminder_count ?? 0) + 1;
    }
    await json(route, {
      data: {
        claimId: ids.claim,
        reminderCount: Number(claim?.reminder_count ?? 1),
        message: 'Alex te recuerda que tienes un cobro pendiente en Pagaste.',
        shareUrl: 'http://127.0.0.1:8081/c/e2e-public-token',
      },
      error: null,
    });
    return;
  }

  state.unhandledRequests.push(`POST /functions/v1/${functionName}`);
  await json(
    route,
    { data: null, error: { code: 'UNHANDLED_E2E_FUNCTION', message: functionName } },
    501,
  );
}

export async function installMockSupabase(
  page: Page,
  state: MockSupabase,
  options: { restDelayMs?: number } = {},
): Promise<void> {
  await page.route('**/*', async (route) => {
    const { pathname } = new URL(route.request().url());
    const isSupabaseRequest = /^\/(?:auth|rest|functions)\/v1\//u.test(pathname);
    if (!isSupabaseRequest) {
      await route.continue();
      return;
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders(route), body: '' });
      return;
    }
    if (pathname.startsWith('/auth/v1/')) return handleAuth(route);
    if (pathname.startsWith('/rest/v1/')) {
      if (options.restDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.restDelayMs));
      }
      return handleRest(route, state);
    }
    if (pathname.startsWith('/functions/v1/')) return handleFunction(route, state);
    state.unhandledRequests.push(`${route.request().method()} ${pathname}`);
    await json(route, { message: `Unhandled Supabase path: ${pathname}` }, 501);
  });
}

export async function signInFromUi(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('login-email').fill('alex@example.com');
  await page.getByTestId('login-password').fill('ClaveSegura8');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('new-expense').waitFor();
}

export const e2eIds = ids;
