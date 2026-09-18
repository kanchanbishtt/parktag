import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import crypto from 'node:crypto';
process.env.SLACK_SIGNING_SECRET='integration-slack-key';
process.env.SLACK_TEAM_ID='TTEST';
process.env.SLACK_CHANNEL_ID='CTEST';
process.env.SLACK_ADMIN_USER_IDS='UTEST';
import { startTestApp, stopTestApp, uniqueAddress } from './helpers.js';
import { getMongoClient } from '../lib/db/mongo.js';
import { setTagStatus, resetTag } from '../lib/core/slack-commands.js';

let app, collections, client, transactions;
const ownerId = new ObjectId();
const ids = [];
const tokens = [];
before(async () => {
  const setup = await startTestApp();
  ({app, collections} = setup);
  client = await getMongoClient(setup.env);
  const hello = await client.db(setup.env.mongoDbName).command({hello:1});
  transactions = Boolean(hello.setName || hello.msg === 'isdbgrid');
  await collections.owners.insertOne({_id:ownerId,displayName:'Slack QA',mobile:'+919999998821'});
});
after(async () => {
  for (const key of ['tags','vaultDocuments','membershipOrders','tagResetHistory']) {
    await collections[key].deleteMany({$or:[{_id:{$in:ids}},{tagId:{$in:ids}}]});
  }
  await collections.verificationSessions.deleteMany({token:{$in:tokens}});
  await collections.pendingCalls.deleteMany({token:{$in:tokens}});
  await collections.shopOrders.deleteMany({orderNumber:'PT-SLACK-TEST'});
  await collections.owners.deleteOne({_id:ownerId});
  await stopTestApp(app);
});
async function tag(extra={}) {
  const _id=new ObjectId();const token='slack-test-'+_id;
  ids.push(_id);tokens.push(token);
  const doc={_id,token,ownerId,status:'active',batchNumber:'Batch-002',serialNumber:991234,internal:true,premium:true,plateNumber:'UP16TEST1234',activatedAt:new Date().toISOString(),...extra};
  await collections.tags.insertOne(doc);return doc;
}
test('deactivated owned tag stays private and cannot be claimed through public activation',async()=>{
  const t=await tag();
  await setTagStatus(collections,t,'deactivate','UADMIN');
  const current=await collections.tags.findOne({_id:t._id});
  assert.equal(String(current.ownerId),String(ownerId));assert.equal(current.status,'inactive');
  const info=await app.inject({method:'GET',url:`/api/tags/${t.token}`,remoteAddress:uniqueAddress()});
  assert.equal(info.statusCode,200,info.body);assert.equal(info.json().tag.claimable,false);
  const activate=await app.inject({method:'POST',url:`/api/tags/${t.token}/activate`,remoteAddress:uniqueAddress(),payload:{displayName:'Other customer',phone:'9999998822',code:'123456',plateNumber:'UP16NEW1234',vehicleType:'car'}});
  assert.equal(activate.statusCode,400,activate.body);assert.match(activate.json().error,/not claimable/);
  await setTagStatus(collections,current,'activate','UADMIN');
  assert.equal((await collections.tags.findOne({_id:t._id})).status,'active');
});
test('unowned inactive stock remains claimable',async()=>{
  const t=await tag({ownerId:null,status:'inactive'});
  const info=await app.inject({method:'GET',url:`/api/tags/${t.token}`,remoteAddress:uniqueAddress()});
  assert.equal(info.statusCode,200,info.body);assert.equal(info.json().tag.claimable,true);
});
test('reset archives ownership, revokes scanner access and preserves physical QR/account/order',async(t)=>{
  if(!transactions)return t.skip('Requires replica-set MongoDB; also verified against isolated Atlas test collections');
  const sticker=await tag({assignedOrderNumber:'PT-SLACK-TEST',emergencyContact:'+919999998822',slackActivationAt:'old'});
  await collections.shopOrders.insertOne({orderNumber:'PT-SLACK-TEST',assignedTagIds:[sticker._id],status:'paid'});
  await collections.verificationSessions.insertOne({token:sticker.token,grantId:'old-grant'});
  await collections.pendingCalls.insertOne({token:sticker.token,consumed:false});
  const result=await resetTag(collections,client,sticker,'UADMIN','reset-test');assert.match(result,/reset and unlinked/);
  const fresh=await collections.tags.findOne({_id:sticker._id});
  assert.equal(fresh.ownerId,null);assert.equal(fresh.status,'unclaimed');assert.equal(fresh.token,sticker.token);assert.equal(fresh.internal,true);
  assert.equal(fresh.emergencyContact,undefined);assert.equal(fresh.assignedOrderNumber,undefined);
  assert.equal(await collections.verificationSessions.countDocuments({token:sticker.token}),0);
  assert.equal(await collections.pendingCalls.countDocuments({token:sticker.token}),0);
  assert.ok(await collections.owners.findOne({_id:ownerId}));
  const order=await collections.shopOrders.findOne({orderNumber:'PT-SLACK-TEST'});assert.deepEqual(order.assignedTagIds,[sticker._id]);
  const history=await collections.tagResetHistory.findOne({tagId:sticker._id});assert.equal(String(history.before.ownerId),String(ownerId));assert.equal(history.before.token,undefined);
  const info=await app.inject({method:'GET',url:`/api/tags/${sticker.token}`,remoteAddress:uniqueAddress()});assert.equal(info.json().tag.claimable,true);
});
test('reset with vault documents or membership orders changes nothing',async(t)=>{
  if(!transactions)return t.skip('Requires replica-set MongoDB; also verified against isolated Atlas test collections');
  for(const key of ['vaultDocuments','membershipOrders']){
    const sticker=await tag();await collections[key].insertOne({tagId:sticker._id,ownerId});
    await assert.rejects(()=>resetTag(collections,client,sticker,'UADMIN','blocked-test'),/Reset stopped/);
    assert.equal(String((await collections.tags.findOne({_id:sticker._id})).ownerId),String(ownerId));
    assert.equal(await collections.tagResetHistory.countDocuments({tagId:sticker._id}),0);
  }
});

test('real app preserves raw form bytes for signed Slack help and rejects tampering',async()=>{
 const body=new URLSearchParams({command:'/parktag',text:'help',team_id:'TTEST',channel_id:'CTEST',user_id:'UTEST'}).toString();
 const timestamp=String(Math.floor(Date.now()/1000));
 const headers={'content-type':'application/x-www-form-urlencoded','x-slack-request-timestamp':timestamp,'x-slack-signature':'v0='+crypto.createHmac('sha256','integration-slack-key').update(`v0:${timestamp}:${body}`).digest('hex')};
 const help=await app.inject({method:'POST',url:'/api/integrations/slack/commands',headers,payload:body,remoteAddress:uniqueAddress()});
 assert.equal(help.statusCode,200,help.body);assert.equal(help.json().response_type,'ephemeral');assert.match(help.json().text,/ParkTag commands/);
 const tampered=await app.inject({method:'POST',url:'/api/integrations/slack/commands',headers,payload:body+'x',remoteAddress:uniqueAddress()});assert.equal(tampered.statusCode,401);
});
