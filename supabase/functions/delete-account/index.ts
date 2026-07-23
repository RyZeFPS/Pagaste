import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ApiError, ok, readJson, serve } from '../_shared/http.ts';
import { requireUser } from '../_shared/supabase.ts';

const inputSchema = z.object({ confirmation: z.literal('ELIMINAR') }).strict();
const STORAGE_PAGE_SIZE = 100;
const STORAGE_DELETE_BATCH_SIZE = 100;
const MAX_EMPTY_CHECK_ATTEMPTS = 4;

function deletionFailed(): ApiError {
  return new ApiError(
    'ACCOUNT_DELETION_FAILED',
    'No se pudo eliminar la cuenta. Inténtalo de nuevo.',
    500,
  );
}

function safeChildPath(root: string, prefix: string, name: string): string {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw deletionFailed();
  }
  const path = `${prefix}/${name}`;
  if (!path.startsWith(`${root}/`)) throw deletionFailed();
  return path;
}

async function deleteStorageTree(
  admin: SupabaseClient,
  bucketName: 'receipts' | 'profile-avatars',
  userId: string,
): Promise<number> {
  const bucket = admin.storage.from(bucketName);
  const folders = [userId];
  const queuedFolders = new Set(folders);
  let removedCount = 0;

  for (let folderIndex = 0; folderIndex < folders.length; folderIndex += 1) {
    const prefix = folders[folderIndex];
    if (!prefix) throw deletionFailed();
    const files: string[] = [];
    let offset = 0;

    while (true) {
      const { data, error } = await bucket.list(prefix, {
        limit: STORAGE_PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error || !data) throw deletionFailed();

      for (const entry of data) {
        const path = safeChildPath(userId, prefix, entry.name);
        if (entry.id === null) {
          if (!queuedFolders.has(path)) {
            queuedFolders.add(path);
            folders.push(path);
          }
        } else {
          files.push(path);
        }
      }

      if (data.length < STORAGE_PAGE_SIZE) break;
      offset += data.length;
    }

    for (let start = 0; start < files.length; start += STORAGE_DELETE_BATCH_SIZE) {
      const batch = files.slice(start, start + STORAGE_DELETE_BATCH_SIZE);
      const { error } = await bucket.remove(batch);
      if (error) throw deletionFailed();
      removedCount += batch.length;
    }
  }

  return removedCount;
}

async function emptyStorageTree(
  admin: SupabaseClient,
  bucketName: 'receipts' | 'profile-avatars',
  userId: string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_EMPTY_CHECK_ATTEMPTS; attempt += 1) {
    if ((await deleteStorageTree(admin, bucketName, userId)) === 0) return;
  }
  throw deletionFailed();
}

serve(async (req) => {
  inputSchema.parse(await readJson(req));
  const { user, admin } = await requireUser(req);

  await emptyStorageTree(admin, 'receipts', user.id);
  await emptyStorageTree(admin, 'profile-avatars', user.id);

  const { error: databaseError } = await admin.rpc('delete_account_data_transaction', {
    p_user_id: user.id,
  });
  if (databaseError) throw deletionFailed();

  const { error: authError } = await admin.auth.admin.deleteUser(user.id, false);
  if (authError) throw deletionFailed();

  return ok(req, { deleted: true });
});
