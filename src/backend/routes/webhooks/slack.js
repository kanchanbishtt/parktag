import crypto from 'node:crypto';
import { getCollections } from '../../lib/db/repositories.js';
import { getMongoClient } from '../../lib/db/mongo.js';
import { CommandError, COMMAND_HELP, parseCommand, runCommand } from '../../lib/core/slack-commands.js';

export function verifySlackSignature(secret, body, timestamp, signature, now = Date.now()) {
  if (!secret || !/^\d{10}$/.test(timestamp || '') || !/^v0=[a-f0-9]{64}$/.test(signature || '') || Math.abs(now/1000-Number(timestamp)) > 300) return false;
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${timestamp}:`).update(body || '').digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
export function validResponseUrl(value, teamId) {
  try { const u = new URL(value); return u.protocol==='https:' && u.hostname==='hooks.slack.com' && !u.port && !u.username && !u.password && u.pathname.startsWith(`/commands/${teamId}/`) && !u.search && !u.hash; } catch { return false; }
}
const privateReply = text => ({
  response_type: 'ephemeral', text,
  // Fall back to text for unusually long records rather than exceed Slack's section limit.
  blocks: text.split('\n\n').some(part => part.length > 3000) ? undefined : text.split('\n\n').flatMap((part, index) => [
    ...(index ? [{ type: 'divider' }] : []),
    { type: 'section', text: { type: 'mrkdwn', text: part, verbatim: true } },
  ]),
});

export function registerSlackCommandRoutes(app, env, dependencies = {}) {
  const load = dependencies.getCollections || getCollections;
  const execute = dependencies.runCommand || runCommand;
  const send = dependencies.fetch || globalThis.fetch;
  app.post('/api/integrations/slack/commands', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, bodyLimit: 16384 }, async (request, reply) => {
    if (!env.slackSigningSecret || !env.slackAdminUserIds || !env.slackTeamId || !env.slackChannelId) return reply.code(503).send({ error:'Slack commands are not configured.' });
    if (!verifySlackSignature(env.slackSigningSecret, request.rawBody, request.headers['x-slack-request-timestamp'], request.headers['x-slack-signature'])) return reply.code(401).send({ error:'Invalid Slack signature.' });
    const body = request.body || {};
    const allowed = env.slackAdminUserIds.split(',').map(s=>s.trim()).filter(Boolean);
    if (body.team_id!==env.slackTeamId || body.channel_id!==env.slackChannelId || !allowed.includes(body.user_id)) return reply.send(privateReply('This command is restricted to approved ParkTag operators in #parktag-logger.'));
    if (body.command!=='/parktag') return reply.send(privateReply('Unsupported command.'));
    let command;
    try { command = parseCommand(body.text); } catch (err) { return reply.send(privateReply(err.message)); }
    if (command.action==='help') return reply.send(privateReply(COMMAND_HELP));
    if (!validResponseUrl(body.response_url, env.slackTeamId)) return reply.code(400).send({ error:'Invalid Slack response URL.' });
    const id = crypto.createHash('sha256').update(request.headers['x-slack-request-timestamp']+':').update(request.rawBody).digest('hex');
    // Acknowledge immediately. Dedup is in Mongo, so Slack retries or another
    // replica cannot run a reset twice. The response URL is never persisted.
    reply.code(200).send(); // Quiet acknowledgement; one private result follows.
    setImmediate(async () => {
      let text;
      let collections;
      try {
        collections = await load(env);
        if (!collections) throw new Error('database unavailable');
        try { await collections.slackCommands.insertOne({ _id:id, actor:body.user_id, command, status:'running', createdAt:new Date() }); }
        catch (error) { if (error.code===11000) return; throw error; }
        const client = command.action==='reset' ? await (dependencies.getMongoClient || getMongoClient)(env) : null;
        text = await execute(collections, env, command, body.user_id, id, client);
        await collections.slackCommands.updateOne({ _id:id }, { $set:{status:'complete',completedAt:new Date()} });
      } catch (error) {
        text = error instanceof CommandError ? error.message : 'The command could not finish. Check the tag/order status before retrying; the request ID is '+id.slice(0,12)+'.';
        app.log.error({ event:'slack-command-failed', commandId:id, action:command.action }, 'Slack command failed');
        await collections?.slackCommands.updateOne({ _id:id }, { $set:{status:'failed',completedAt:new Date()} }).catch(()=>{});
      }
      try {
        const result = await send(body.response_url, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(privateReply(text)), signal:AbortSignal.timeout(10000), redirect:'error' });
        if (!result.ok) throw new Error('response rejected');
      } catch { app.log.error({event:'slack-reply-failed',commandId:id},'Slack command response failed'); }
    });
  });
}
