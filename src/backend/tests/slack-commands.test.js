import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { ObjectId } from 'mongodb';
import { verifySlackSignature, validResponseUrl, registerSlackCommandRoutes } from '../routes/webhooks/slack.js';
import { parseCommand, resetDocument, findTag, setTagStatus } from '../lib/core/slack-commands.js';

const secret='test-signing-key';
function signed(text='tag PT-Batch-002-000007', overrides={}) {
 const body=new URLSearchParams({command:'/parktag',text,team_id:'TTEST',channel_id:'CTEST',user_id:'UTEST',response_url:'https://hooks.slack.com/commands/TTEST/123/test',...overrides}).toString();
 const timestamp=String(Math.floor(Date.now()/1000));
 return {method:'POST',url:'/api/integrations/slack/commands',payload:body,headers:{'content-type':'application/x-www-form-urlencoded','x-slack-request-timestamp':timestamp,'x-slack-signature':'v0='+crypto.createHmac('sha256',secret).update(`v0:${timestamp}:${body}`).digest('hex')}};
}
const env={slackSigningSecret:secret,slackTeamId:'TTEST',slackChannelId:'CTEST',slackAdminUserIds:'UTEST'};
async function appFor(deps={}) {
 const app=Fastify();
 app.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(r,b,done)=>{r.rawBody=Buffer.from(b);done(null,Object.fromEntries(new URLSearchParams(b)));});
 registerSlackCommandRoutes(app,env,deps);await app.ready();return app;
}
test('signature checks exact payload, timestamp freshness and malformed signatures',()=>{
 const r=signed();const h=r.headers;
 assert.equal(verifySlackSignature(secret,r.payload,h['x-slack-request-timestamp'],h['x-slack-signature']),true);
 assert.equal(verifySlackSignature(secret,r.payload+'x',h['x-slack-request-timestamp'],h['x-slack-signature']),false);
 assert.equal(verifySlackSignature(secret,r.payload,h['x-slack-request-timestamp'],h['x-slack-signature'],Date.now()+301000),false);
 assert.equal(verifySlackSignature(secret,r.payload,h['x-slack-request-timestamp'],'x'),false);
});
test('callback URL cannot redirect to another host or workspace',()=>{
 assert.equal(validResponseUrl('https://hooks.slack.com/commands/TTEST/123/test','TTEST'),true);
 for(const u of ['http://hooks.slack.com/commands/TTEST/x','https://hooks.slack.com.evil.test/commands/TTEST/x','https://hooks.slack.com/commands/TOTHER/x','https://user@hooks.slack.com/commands/TTEST/x']) assert.equal(validResponseUrl(u,'TTEST'),false);
});
test('permission checks reject other user, workspace and channel before execution',async()=>{
 const app=await appFor({getCollections:()=>{throw Error('must never reach DB');}});
 try {
  for(const overrides of [{user_id:'UOTHER'},{team_id:'TOTHER'},{channel_id:'COTHER'}]) {
   const res=await app.inject(signed('reset PT-Batch-002-000007 confirm',overrides));
   assert.match(res.json().text,/restricted/);
  }
  const forged=signed();forged.headers['x-slack-signature']='v0='+'0'.repeat(64);
  assert.equal((await app.inject(forged)).statusCode,401);
  assert.match((await app.inject(signed('help'))).json().text,/ParkTag commands/);
 } finally {await app.close();}
});
test('duplicate Slack deliveries execute only once and respond privately',async()=>{
 let executed=0;const seen=new Set();let resolve;
 const responded=new Promise(r=>resolve=r);
 const app=await appFor({getCollections:async()=>({slackCommands:{insertOne:async d=>{if(seen.has(d._id))throw Object.assign(Error(),{code:11000});seen.add(d._id);},updateOne:async()=>{}}}),runCommand:async()=>{executed++;return 'done';},fetch:async(u,o)=>{assert.equal(JSON.parse(o.body).response_type,'ephemeral');assert.equal(o.redirect,'error');resolve();return {ok:true};}});
 try {const req=signed();await app.inject(req);await responded;await app.inject(req);await new Promise(r=>setImmediate(r));assert.equal(executed,1);} finally {await app.close();}
});
test('reset requires explicit confirm and accepts full hyphenated batch names',()=>{
 assert.throws(()=>parseCommand('reset PT-Batch-002-000007'),/confirm/);
 assert.deepEqual(parseCommand('reset PT-Batch-002-000007 confirm'),{action:'reset',argument:'PT-Batch-002-000007'});
 assert.throws(()=>parseCommand('activate'),/identifier/);
});
test('reset retains printed identity but removes all owner-specific fields including unknown ones',()=>{
 const tag={_id:new ObjectId(),token:'same-printed-qr',batchNumber:'Batch-002',serialNumber:7,premium:true,internal:true,ownerId:new ObjectId(),status:'active',plateNumber:'secret',emergencyContact:{phone:'secret'},activatedAt:'old',assignedOrderNumber:'old-order',slackActivationAt:'old',futurePrivateField:'secret'};
 const reset=resetDocument(tag,'UADMIN','2026-09-18T00:00:00Z');
 assert.equal(reset.token,tag.token);assert.equal(reset._id,tag._id);assert.equal(reset.ownerId,null);assert.equal(reset.status,'unclaimed');assert.equal(reset.internal,true);
 for(const key of ['emergencyContact','activatedAt','assignedOrderNumber','slackActivationAt','futurePrivateField'])assert.equal(reset[key],undefined);
 assert.equal(reset.purchaseStatus,'none');assert.equal(reset.physicalTagPurchased,false);
});
test('lookup distinguishes same serial across batches; status refuses unclaimed stock',async()=>{
 const tags=[{_id:1,batchNumber:'01',serialNumber:7},{_id:2,batchNumber:'Batch-002',serialNumber:7}];
 const c={tags:{find:()=>({limit:()=>({toArray:async()=>tags})})}};
 assert.equal((await findTag(c,'PT-Batch-002-000007'))._id,2);
 assert.equal((await findTag(c,'PT-01-000007'))._id,1);
 await assert.rejects(()=>findTag(c,'000007'),/complete/);
 await assert.rejects(()=>setTagStatus(c,tags[0],'activate','UADMIN'),/no linked owner/);
});
