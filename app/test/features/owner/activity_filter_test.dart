import 'package:app/core/models.dart';
import 'package:app/features/owner/activity_screen.dart';
import 'package:flutter_test/flutter_test.dart';

ContactRequest req(String token) =>
    ContactRequest.fromJson({'id': 'r-$token', 'token': token});

void main() {
  final recent = [req('a'), req('b')];

  test('keeps a filter whose vehicle has recent rows', () {
    expect(activityFilterToken('a', recent), 'a');
  });

  test('falls back to All for a vehicle with no recent rows', () {
    expect(activityFilterToken('c', recent), isNull);
  });

  test('falls back to All for an unknown tag or no filter', () {
    expect(activityFilterToken(null, recent), isNull);
    expect(activityFilterToken('a', const []), isNull);
  });
}
