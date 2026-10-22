import 'package:app/core/qr_parse.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final t12 = 'A' * 12;
  final t64 = 'a1' * 32;

  group('accepts', () {
    for (final (url, token) in [
      ('https://app.parktag.me/tag/$t12', t12),
      ('https://app.parktag.me/tag/$t64', t64),
      ('https://app.parktag.me/vehicle/$t12', t12),
      ('https://app.parktag.me/vehicle/$t64/', t64),
      ('https://app.parktag.me/tag/$t12/', t12),
      ('https://app.parktag.me/tag?token=$t12', t12),
      ('https://app.parktag.me/vehicle?token=$t64', t64),
      ('https://app.parktag.me/tag/$t12?src=qr', t12),
      ('  https://app.parktag.me/tag/$t12  ', t12),
    ]) {
      test(url, () => expect(parseTagUrl(url), token));
    }
  });

  group('rejects', () {
    for (final url in [
      'http://app.parktag.me/tag/$t12',
      'https://evil.com/tag/$t12',
      'https://app.parktag.me.evil.com/tag/$t12',
      'https://evil.app.parktag.me/tag/$t12',
      'https://app.parktag.me@evil.com/tag/$t12',
      'https://user@app.parktag.me/tag/$t12',
      'https://user:pw@app.parktag.me/tag/$t12',
      'https://app.parktag.me:8443/tag/$t12',
      'https://app.parktag.me/tag/${'A' * 11}',
      'https://app.parktag.me/tag/${'A' * 65}',
      'https://app.parktag.me/tag/${'A' * 11}-',
      'https://app.parktag.me/tag/${'A' * 12}%20',
      'https://app.parktag.me/tag/abc_def_ghij',
      'https://app.parktag.me/tag?token=${'A' * 11}',
      'https://app.parktag.me/tag?token=$t12!',
      'https://app.parktag.me/other/$t12',
      'https://app.parktag.me/tag/$t12/extra',
      'https://app.parktag.me/?token=$t12',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      test(url, () => expect(parseTagUrl(url), isNull));
    }
  });
}
