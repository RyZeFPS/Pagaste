-- Every authenticated claim creation must pass through the wrapper that applies
-- bilateral debt offsets. The wrapper remains callable by authenticated users;
-- its SECURITY DEFINER owner can invoke this inner function after the revoke.

revoke execute on function public.create_claims_transaction(uuid, jsonb)
  from authenticated;
