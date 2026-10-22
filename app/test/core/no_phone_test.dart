import 'package:app/core/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('ContactRequest.fromJson ignores phone', () {
    final r = ContactRequest.fromJson({
      'id': 'r1',
      'token': 'tok',
      'phone': '+919876543210',
      'phoneLast4': '3210',
      'hasPhone': true,
    });
    expect(r.phoneLast4, '3210');
    expect(r.hasPhone, isTrue);
    expect(r.raw.containsKey('phone'), isFalse);
    expect(r.raw.values.join(' '), isNot(contains('9876543210')));
  });

  test('hasPhone defaults to false', () {
    final r = ContactRequest.fromJson({'id': 'r1'});
    expect(r.hasPhone, isFalse);
    expect(r.phoneLast4, isNull);
  });
}
