import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

// Play policy: the app never sells digital goods. These endpoints must not
// appear anywhere in lib/.
const forbidden = [
  '/api/owner/membership/create-order',
  '/api/owner/membership/verify-payment',
  '/membership/create-order',
  '/membership/verify-payment',
  '/subscribe',
  '/subscription/verify',
  '/api/owner/callback/create-order',
  '/api/owner/callback/verify-payment',
  '/callback/create-order',
  '/callback/verify-payment',
];

void main() {
  test('lib/ has no membership or callback purchase endpoints', () {
    final hits = <String>[];
    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart')) continue;
      final text = f.readAsStringSync();
      for (final s in forbidden) {
        if (text.contains(s)) hits.add('${f.path}: $s');
      }
    }
    expect(hits, isEmpty);
  });
}
