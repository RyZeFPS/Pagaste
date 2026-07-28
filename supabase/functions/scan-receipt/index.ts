import { z } from 'zod';
import { ApiError, fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { receiptOcrProvider } from '../_shared/ocr.ts';
import { requireUser } from '../_shared/supabase.ts';

const inputSchema = z
  .object({
    expenseId: z.string().uuid(),
    receiptPath: z.string().trim().min(10).max(700).optional(),
    persistResult: z.boolean().default(true),
    locale: z.string().trim().min(2).max(35).default('es-ES'),
    currencyHint: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
  })
  .strict();

function normalizePath(path: string): string {
  return path.startsWith('receipts/') ? path.slice('receipts/'.length) : path;
}

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { user, client, admin } = await requireUser(req);
  const provider = receiptOcrProvider();
  const { data: expense, error: expenseError } = await client
    .from('expenses')
    .select('id,created_by,status,receipt_path')
    .eq('id', input.expenseId)
    .maybeSingle();
  if (expenseError) throw fromDatabaseError(expenseError, 'EXPENSE_LOOKUP_FAILED');
  if (!expense) throw new ApiError('EXPENSE_NOT_FOUND', 'No se encontró el gasto.', 404);
  if (expense.created_by !== user.id || expense.status !== 'draft') {
    throw new ApiError('EXPENSE_NOT_EDITABLE', 'Este gasto ya no se puede escanear.', 403);
  }

  const receiptPath = normalizePath(input.receiptPath ?? expense.receipt_path ?? '');
  const prefix = `${user.id}/${input.expenseId}/`;
  if (!receiptPath.startsWith(prefix) || !/\.(jpe?g|png|webp)$/iu.test(receiptPath)) {
    throw new ApiError('INVALID_RECEIPT_PATH', 'La ruta del ticket no es válida.');
  }
  if (input.persistResult && receiptPath !== expense.receipt_path) {
    const { error } = await client
      .from('expenses')
      .update({ receipt_path: receiptPath })
      .eq('id', input.expenseId);
    if (error) throw fromDatabaseError(error, 'RECEIPT_PATH_UPDATE_FAILED');
  }

  // The free allowance counts attempts, including provider failures, so retries
  // cannot be used to bypass the quota under concurrent requests.
  const { error: usageError } = await admin.rpc('reserve_ocr_scan', { p_user_id: user.id });
  if (usageError) throw fromDatabaseError(usageError, 'OCR_LIMIT_REACHED');

  const { data: job, error: jobError } = await admin
    .from('receipt_scan_jobs')
    .insert({
      expense_id: input.expenseId,
      provider: provider.name,
      status: 'processing',
    })
    .select('id')
    .single();
  if (jobError || !job) throw fromDatabaseError(jobError, 'SCAN_JOB_CREATE_FAILED');
  if (input.persistResult) {
    await admin.from('expenses').update({ scan_status: 'processing' }).eq('id', input.expenseId);
  }

  try {
    const { data: signed, error: signedError } = await admin.storage
      .from('receipts')
      .createSignedUrl(receiptPath, 120);
    if (signedError || !signed?.signedUrl)
      throw new ApiError('RECEIPT_UNAVAILABLE', 'No se pudo abrir el ticket.', 404);
    const scanned = await provider.scanReceipt({
      imageUrl: signed.signedUrl,
      locale: input.locale,
      currencyHint: input.currencyHint,
    });
    const { data: learnedCorrections } = await admin.rpc('suggest_anonymous_ocr_corrections', {
      p_ocr_texts: scanned.items.map((item) => item.name),
    });
    const correctionMap =
      learnedCorrections &&
      typeof learnedCorrections === 'object' &&
      !Array.isArray(learnedCorrections)
        ? (learnedCorrections as Record<string, unknown>)
        : {};
    const correctedItems = scanned.items.map((item) => {
      const suggestion = correctionMap[item.name.trim().toLocaleLowerCase()];
      return typeof suggestion === 'string' && suggestion.trim()
        ? { ...item, name: suggestion.trim() }
        : item;
    });
    const itemTotal = correctedItems.reduce((sum, item) => sum + BigInt(item.lineTotalCents), 0n);
    const warnings =
      itemTotal === BigInt(scanned.totalCents)
        ? scanned.warnings
        : [...scanned.warnings.slice(0, 29), 'items_do_not_match_total'];
    const result = { ...scanned, items: correctedItems, warnings };
    if (input.persistResult) {
      const { error: applyError } = await admin.rpc('apply_receipt_scan_result', {
        p_job_id: job.id,
        p_expense_id: input.expenseId,
        p_result: result,
      });
      if (applyError) throw fromDatabaseError(applyError, 'SCAN_RESULT_SAVE_FAILED');
    } else {
      const { error: jobCompleteError } = await admin
        .from('receipt_scan_jobs')
        .update({
          status: 'completed',
          confidence: result.confidence,
          warnings: result.warnings,
          completed_at: new Date().toISOString(),
          error_code: null,
        })
        .eq('id', job.id)
        .eq('expense_id', input.expenseId);
      if (jobCompleteError) {
        throw fromDatabaseError(jobCompleteError, 'SCAN_JOB_COMPLETE_FAILED');
      }
    }
    return ok(req, {
      jobId: job.id,
      provider: provider.name,
      status: 'completed' as const,
      ...result,
      items: result.items.map((item) => ({ ...item, category: null })),
    });
  } catch (error) {
    const errorCode =
      error instanceof ApiError
        ? error.code
        : error instanceof z.ZodError
          ? 'OCR_RESPONSE_INVALID'
          : 'OCR_FAILED';
    const jobFailure = admin
      .from('receipt_scan_jobs')
      .update({ status: 'failed', error_code: errorCode, completed_at: new Date().toISOString() })
      .eq('id', job.id);
    await Promise.all(
      input.persistResult
        ? [
            jobFailure,
            admin.from('expenses').update({ scan_status: 'failed' }).eq('id', input.expenseId),
          ]
        : [jobFailure],
    );
    if (error instanceof ApiError) throw error;
    if (error instanceof z.ZodError)
      throw new ApiError('OCR_RESPONSE_INVALID', 'El OCR devolvió datos no válidos.', 502);
    throw new ApiError(
      'OCR_FAILED',
      'No se pudo leer el ticket. Puedes introducirlo manualmente.',
      502,
    );
  }
});
