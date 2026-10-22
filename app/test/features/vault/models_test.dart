import 'package:app/core/api.dart';
import 'package:app/core/models.dart';
import 'package:app/features/vault/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('part type comes from the extension, only the four allowed types', () {
    expect(uploadMediaType('a.PDF')?.mimeType, 'application/pdf');
    expect(uploadMediaType('a.jpg')?.mimeType, 'image/jpeg');
    expect(uploadMediaType('a.JPEG')?.mimeType, 'image/jpeg');
    expect(uploadMediaType('a.png')?.mimeType, 'image/png');
    expect(uploadMediaType('a.webp')?.mimeType, 'image/webp');
    for (final bad in ['a.heic', 'a.svg', 'pdf', 'a.pdf.exe', 'a']) {
      expect(uploadMediaType(bad), isNull, reason: bad);
    }
  });

  test('client checks: extension, then 5MB', () {
    expect(checkUpload('a.pdf', maxUploadBytes), isNull);
    expect(checkUpload('a.pdf', maxUploadBytes + 1), tooBigMessage);
    expect(checkUpload('a.gif', 10), badTypeMessage);
    expect(checkUpload('a.jpg', 0), isNotNull);
  });

  test('upload errors map to local copy', () {
    expect(
      uploadErrorMessage(
        ApiError(409, code: 'STORAGE_FULL', message: 'Upgrade'),
      ),
      contains('storage is full'),
    );
    expect(
      uploadErrorMessage(ApiError(409, code: 'DOCUMENT_LIMIT_REACHED')),
      contains('no document slots'),
    );
    expect(uploadErrorMessage(ApiError(413)), tooBigMessage);
    expect(uploadErrorMessage(ApiError(415)), badTypeMessage);
    expect(
      uploadErrorMessage(ApiError(404, message: 'Vehicle not found.')),
      'Vehicle not found.',
    );
  });

  test('429 adds the wait', () {
    expect(
      rateLimitMessage(
        ApiError(
          429,
          message: 'Slow down.',
          retryAfter: const Duration(seconds: 30),
        ),
      ),
      'Slow down. Wait 30 seconds.',
    );
    expect(
      rateLimitMessage(
        ApiError(
          429,
          message: 'Slow down.',
          retryAfter: const Duration(seconds: 61),
        ),
      ),
      'Slow down. Wait 2 minutes.',
    );
    expect(
      rateLimitMessage(ApiError(429, message: 'Slow down.')),
      'Slow down.',
    );
  });

  test('only picker copies under the cache dir are deletable', () {
    const cache = '/data/user/0/me.parktag.app/cache';
    expect(isPickerCopy('$cache/file_picker/1/id.pdf', cache), isTrue);
    expect(isPickerCopy('$cache/scaled_x.jpg', '$cache/'), isTrue);
    expect(isPickerCopy('/storage/emulated/0/Download/id.pdf', cache), isFalse);
    expect(isPickerCopy('${cache}2/id.pdf', cache), isFalse);
    expect(isPickerCopy('$cache/../files/id.pdf', cache), isFalse);
    expect(isPickerCopy('', cache), isFalse);
    expect(isPickerCopy('/a.pdf', ''), isFalse);
  });

  group('allowance', () {
    final now = DateTime(2026, 10, 19, 12);
    VaultEntitlement ent({
      int max = 3,
      bool premium = true,
      DateTime? trialEnds,
    }) => VaultEntitlement.fromJson({
      'tier': premium ? 'premium' : 'etag',
      'maxDocs': max,
      'premium': premium,
      'subscribed': false,
      'trialEndsAt': trialEnds?.toUtc().toIso8601String(),
    });
    final limits = VaultLimits.fromJson({
      'maxFileBytes': 5242880,
      'maxBytesPerOwner': 41943040,
      'tiers': {'etag': 1, 'premium': 3, 'subscribed': 10},
    });

    test('tally shows X of N and the owner cap', () {
      expect(
        vaultTally(2, 1536 * 1024, ent(), limits),
        '2 of 3 documents on this vehicle · using 1.5 MB of 40 MB',
      );
      expect(
        vaultTally(0, 0, ent(max: 1, premium: false), null),
        '0 of 1 document on this vehicle · using 0 B of 40 MB',
      );
      expect(
        vaultTally(6, 0, ent(), limits),
        "6 documents on this vehicle · this tag's allowance is 3 · using 0 B of 40 MB",
      );
      expect(vaultTally(1, 0, null, null), startsWith('1 document on this'));
    });

    test('full only when the server sent an allowance that is used up', () {
      expect(isVehicleFull(3, ent()), isTrue);
      expect(isVehicleFull(4, ent()), isTrue);
      expect(isVehicleFull(2, ent()), isFalse);
      expect(isVehicleFull(99, null), isFalse);
    });

    test('trial days round up and never go negative', () {
      expect(trialDaysLeft(ent(), now), isNull);
      expect(
        trialDaysLeft(ent(trialEnds: now.add(const Duration(hours: 1))), now),
        1,
      );
      expect(
        trialDaysLeft(ent(trialEnds: now.add(const Duration(days: 30))), now),
        30,
      );
      expect(
        trialDaysLeft(
          ent(trialEnds: now.subtract(const Duration(days: 2))),
          now,
        ),
        0,
      );
    });

    test('trial note is read-only, with no upgrade or subscribe prompt', () {
      final e = ent(max: 10, trialEnds: now.add(const Duration(days: 5)));
      final note = trialNote(e, limits, now)!;
      expect(note, contains('5 days'));
      expect(note, contains('keeps 3 documents'));
      final full = trialNote(e, limits, now, full: true)!;
      expect(full, contains('free period has 5 days left'));
      for (final s in [
        note,
        full,
        fullCardBody(e),
        fullCardBody(ent(premium: false)),
      ]) {
        expect(s.toLowerCase(), isNot(contains('subscribe')));
        expect(s.toLowerCase(), isNot(contains('upgrade')));
        expect(s, isNot(contains('₹')));
      }
      expect(trialNote(ent(premium: false), limits, now), isNull);
      expect(trialNote(null, limits, now), isNull);
    });
  });

  test('doc parses thumb data URI and createdAt', () {
    final d = VaultDoc.fromJson({
      'id': 'd1',
      'thumb': 'data:image/jpeg;base64,AAEC',
      'createdAt': '2026-10-03T10:00:00.000Z',
    });
    expect(d.thumb, [0, 1, 2]);
    expect(formatDate(d.createdAt), contains('Oct 2026'));
    expect(thumbBytes('data:image/png;base64,AAEC'), isNull);
    expect(thumbBytes('data:image/jpeg;base64,***'), isNull);
    expect(VaultDoc.fromJson({'id': 'x'}).thumb, isNull);
    expect(formatDate(null), '');
  });
}
