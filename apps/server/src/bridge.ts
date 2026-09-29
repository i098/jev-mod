import { z } from 'zod';
import { createStore } from '@jev-mod/db/index.ts';
import { settingsSchema, snowflake } from '@jev-mod/core/policy.ts';

const caseSchema = z.object({ guildId: snowflake, channelId: snowflake, messageId: snowflake, authorId: snowflake,
  messageHash: z.string().regex(/^[a-f0-9]{64}$/), policyVersion: z.number().int().nonnegative(), content: z.string().max(4000),
  matches: z.array(z.object({ id: z.string().max(40), name: z.string().max(100), probability: z.number().min(0).max(1),
    action: z.enum(['log', 'delete', 'timeout']), threshold: z.number().optional() })).max(10),
  model: z.string().max(100).nullable(), requestedAction: z.enum(['log', 'delete', 'timeout']), outcome: z.literal('pending'),
});
const id = z.string().regex(/^\d{1,16}$/);
const requestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('getSettings'), args: z.tuple([snowflake]) }),
  z.object({ method: z.literal('registerGuild'), args: z.tuple([snowflake]) }),
  z.object({ method: z.literal('forgetGuild'), args: z.tuple([snowflake]) }),
  z.object({ method: z.literal('allGuilds'), args: z.tuple([]) }),
  z.object({ method: z.literal('saveSettings'), args: z.tuple([snowflake, settingsSchema, z.number().int().nonnegative(), snowflake]) }),
  z.object({ method: z.literal('addCase'), args: z.tuple([caseSchema]) }),
  z.object({ method: z.literal('finishCase'), args: z.tuple([snowflake, id, z.enum(['monitored', 'logged', 'policy_changed', 'message_changed', 'exempt', 'already_gone', 'member_check_failed', 'missing_permission', 'deleted', 'delete_failed', 'deleted_timed_out', 'deleted_timeout_failed', 'deleted_timeout_skipped'])]) }),
  z.object({ method: z.literal('consumeBudget'), args: z.tuple([z.enum(['jev:global']), z.number().int().min(1).max(600)]) }),
]);
export async function storeBridge(request: Request, binding: D1Database) {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/store') return new Response('Not found', { status: 404 });
  const text = await request.text();
  if (text.length > 65536) return new Response('Too large', { status: 413 });
  try {
    const data = requestSchema.parse(JSON.parse(text));
    const store = createStore(binding);
    let result;
    switch (data.method) {
      case 'getSettings': result = await store.getSettings(...data.args); break;
      case 'registerGuild': result = await store.registerGuild(...data.args); break;
      case 'forgetGuild': result = await store.forgetGuild(...data.args); break;
      case 'allGuilds': result = await store.allGuilds(); break;
      case 'saveSettings': result = await store.saveSettings(...data.args); break;
      case 'addCase': result = await store.addCase(...data.args); break;
      case 'finishCase': result = await store.finishCase(...data.args); break;
      case 'consumeBudget': result = await store.consumeBudget(...data.args); break;
    }
    return Response.json({ result: result ?? null });
  } catch (error) {
    return Response.json({ error: 'Store operation failed.' }, { status: error instanceof z.ZodError ? 400 : 503 });
  }
}
