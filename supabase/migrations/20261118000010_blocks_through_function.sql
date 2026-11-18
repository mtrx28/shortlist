-- Shortlist: blocks can only be created through block_user().
--
-- Until now a signed-in user could insert a row into "blocks" straight from the
-- API. That skipped the daily limit and left an open chat running. From now on
-- the only way to block is block_user() (server only), which counts recent
-- blocks, ends the live chats and frees the slots. Reading your own blocks and
-- removing one (unblock) stay as they were.
-- (The earlier migrations are already applied, so this is a new file.)

drop policy blocks_insert_own on public.blocks;
revoke insert on public.blocks from authenticated;
