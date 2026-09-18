# PT-Batch-002 is internal testing stock

User confirmed 2026-09-18: all of batchNumber Batch-002 (serial prefix PT-Batch-002) is testing only, not customer purchases.

Production repair: 10 tags marked internal, purchaseStatus none, physicalTagPurchased false. Removed incorrect phone-derived link on serial 7 to internal COD order PT-260728-00002 and removed the tag from that order assignedTagIds.

App guards: never auto-link test tags to orders; exclude internal orders from link candidates; skip server TagActivated for test tags/internal phones and server Purchase for internal orders/internal shipping phones. Browser purchase events are a separate path and were not changed in this correction.

n8n workflows 7IPVApvcnzl0TKor (Sticker Activated) and stsSmcBv6wmj0XlL (Daily Digest) updated and published. Activation wording checks tag internal, Batch-002, order internal and internal channel before displaying purchase text. Daily order aggregation excludes internal, giveaway and deleted orders. Existing Slack message was not edited or reposted.

41 targeted tests passed. Deployment bbbebd4f-20b1-4737-9de0-ae86bf546692.
