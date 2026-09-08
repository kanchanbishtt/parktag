#!/usr/bin/env bash
# Can WhatsApp actually send right now?
#
# Read-only: sends no message and costs nothing, so it is safe to poll.
# Meta reports eligibility per entity (phone number, WABA, business, app), and
# a billing failure like 131042 shows up here as the BUSINESS entity going
# BLOCKED or LIMITED. That is how an unpaid account silently killed OTPs while
# the template, the number and the token all still looked perfectly healthy.
#
# SIP errors (138024 / 138025) are about WhatsApp Business Calling and are
# ignored here: they do not affect messaging.
#
# Exit 0 = can send. Exit 1 = something is blocking. Exit 2 = API error.
set -euo pipefail
cd "$(dirname "$0")/.."

eval "$(python3 - <<'PY'
env = {}
for line in open('.env'):
    if '=' in line and not line.lstrip().startswith('#'):
        k, _, v = line.partition('=')
        env[k.strip()] = v.strip().strip('"').strip("'")
print('TOK=' + env['META_WHATSAPP_ACCESS_TOKEN'])
print('PID=' + env['META_WHATSAPP_PHONE_NUMBER_ID'])
PY
)"

curl -sS -G "https://graph.facebook.com/v21.0/$PID" \
  --data-urlencode "fields=health_status,display_phone_number,quality_rating" \
  -H "Authorization: Bearer $TOK" > /tmp/wa-health.json

python3 - <<'PY'
import json, sys
d = json.load(open('/tmp/wa-health.json'))
if 'error' in d:
    print('API error:', d['error'].get('message'))
    sys.exit(2)
h = d.get('health_status', {})
print('%s  quality=%s' % (d.get('display_phone_number', '?'), d.get('quality_rating', '?')))
print('overall: %s' % h.get('can_send_message', '?'))
SIP = (138024, 138025)
bad = False
for e in h.get('entities', []):
    state = e.get('can_send_message', '?')
    if state != 'AVAILABLE':
        bad = True
        print('  %-13s %s   <-- BLOCKING SENDS' % (e.get('entity_type', '?'), state))
    else:
        print('  %-13s %s' % (e.get('entity_type', '?'), state))
    for err in e.get('errors', []):
        if err.get('error_code') in SIP:
            continue
        bad = True
        print('      %s: %s' % (err.get('error_code'), err.get('error_description')))
        if err.get('possible_solution'):
            print('      fix: %s' % err['possible_solution'])
sys.exit(1 if bad else 0)
PY
