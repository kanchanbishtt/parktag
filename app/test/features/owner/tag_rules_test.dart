import 'package:app/core/models.dart';
import 'package:app/features/owner/owner_common.dart';
import 'package:app/features/owner/tag_card.dart';
import 'package:app/features/owner/tag_etag.dart';
import 'package:app/features/owner/tag_rules.dart';
import 'package:app/features/owner/tag_sections.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

Tag tag(Map<String, dynamic> extra) => Tag.fromJson({
  'id': 't1',
  'token': 'tokAAAAAAAAA',
  'scanUrl': 'https://app.parktag.me/tag/tokAAAAAAAAA',
  'status': 'active',
  'plateNumber': 'MH12AB1234',
  'vehicleType': 'car',
  'vehicleLabel': 'Car',
  ...extra,
});

void main() {
  group('tagPill', () {
    test('premium, free count, used', () {
      expect(tagPill(tag({'premium': true})).label, 'Premium');
      expect(tagPill(tag({'freeContactsLeft': 2})).label, '2 Free Calls');
      expect(tagPill(tag({'freeContactsLeft': 1})).label, '1 Free Call');
      expect(tagPill(tag({})).label, '1 Free Call');
      expect(tagPill(tag({'freeContactUsed': true})).kind, TagPillKind.used);
    });
  });

  group('locked E-Tag', () {
    test('trialExpired only for a spent free tag', () {
      expect(trialExpired(tag({'freeContactUsed': true})), isTrue);
      expect(
        trialExpired(tag({'freeContactUsed': true, 'premium': true})),
        isFalse,
      );
      expect(trialExpired(tag({})), isFalse);
    });

    test('note names the missed count, else the used allowance', () {
      expect(
        lockedTagNote(tag({'missedContacts': 1})),
        startsWith('1 person tried'),
      );
      expect(
        lockedTagNote(tag({'missedContacts': 3})),
        startsWith('3 people tried'),
      );
      expect(
        lockedTagNote(tag({})),
        startsWith('Your free call has been used'),
      );
      expect(
        lockedTagNote(tag({'freeContactAllowance': 2})),
        startsWith('Your free calls have been used'),
      );
    });

    test('replace path carries tag id and shop variant', () {
      expect(replaceShopPath(tag({})), '/shop?replaceTagId=t1&variant=Car');
      expect(
        replaceShopPath(tag({'vehicleType': 'auto_rickshaw'})),
        '/shop?replaceTagId=t1&variant=Auto',
      );
      for (final none in [null, 'truck', 'bus']) {
        expect(
          replaceShopPath(tag({'vehicleType': none})),
          '/shop?replaceTagId=t1',
        );
      }
    });
  });

  group('membership', () {
    final now = DateTime.utc(2026, 10, 19, 12);
    Membership m(Map<String, dynamic> j) => Membership.fromJson(j);

    test('live days recomputed against endsAt, rounded up', () {
      final v = liveMembership(
        m({
          'state': 'trial',
          'endsAt': '2026-10-21T00:00:00.000Z',
          'daysLeft': 9,
          'totalDays': 365,
          'elapsedDays': 356,
        }),
        now,
      );
      expect(v.daysLeft, 2);
      expect(v.elapsedDays, 363);
      expect(membershipFigure(v), '2 days left');
      expect(membershipProgress(v), closeTo(363 / 365, 1e-9));
    });

    test('passed end instant reads as lapsed', () {
      final v = liveMembership(
        m({'state': 'trial', 'endsAt': '2026-10-01T00:00:00.000Z'}),
        now,
      );
      expect(v.state, 'lapsed');
      expect(membershipFigure(v), 'Expired');
      expect(membershipSub(v, formatDate), 'Premium has ended on this tag.');
    });

    test('open, subscribed and included wording, no bar without total', () {
      final open = m({'state': 'open'});
      expect(membershipFigure(open), 'Active');
      expect(membershipSub(open, formatDate), contains('no end date'));
      final sub = m({
        'state': 'subscribed',
        'endsAt': '2027-01-05T00:00:00Z',
        'daysLeft': 78,
      });
      expect(membershipSub(sub, (_) => 'D'), 'Premium until D.');
      expect(membershipProgress(sub), isNull);
      final trial = m({
        'state': 'trial',
        'endsAt': '2027-01-05T00:00:00Z',
        'daysLeft': 1,
      });
      expect(membershipFigure(trial), '1 day left');
      expect(
        membershipSub(trial, (_) => 'D'),
        '1 year Premium included, until D.',
      );
    });

    test('no copy mentions a price or renewal', () {
      for (final s in ['lapsed', 'open', 'subscribed', 'trial']) {
        final text = membershipSub(m({'state': s}), formatDate).toLowerCase();
        expect(text, isNot(contains('renew')));
        expect(text, isNot(contains('rs')));
      }
    });
  });

  group('vehicle types', () {
    test('web picker order', () {
      expect(vehicleTypeOptions.map((o) => o.type).toList(), [
        'car',
        'bike',
        'truck',
        'bus',
        'auto_rickshaw',
        'scooter',
      ]);
    });

    test('mount mismatch', () {
      expect(mountMismatch(null, 'bike'), isNull);
      expect(mountMismatch('four_wheeler', 'car'), isNull);
      expect(mountMismatch('two_wheeler', 'scooter'), isNull);
      final m = mountMismatch('four_wheeler', 'bike')!;
      expect(m.title, "This tag won't fit a Bike");
      expect(m.text, contains('windscreen tag'));
      expect(m.text, contains('needs an exterior tag'));
      expect(
        mountMismatch('two_wheeler', 'auto_rickshaw')!.title,
        "This tag won't fit a Auto",
      );
    });
  });

  group('E-Tag sheet', () {
    test('prints plate, E-Tag ID without PT-, status and serial', () {
      final s = EtagSheet(
        tag({'etagId': 'PT-AB12CD', 'serial': 'S-0042', 'status': 'inactive'}),
      );
      expect(s.etagLine, 'E-Tag AB12CD  ·  MH12AB1234  ·  Inactive');
      expect(s.serial, 'S-0042');
      expect(s.fileName, 'parktag-MH12AB1234.png');
      expect(s.heading, contains('E-Tag'));
      expect(EtagSheet(tag({'premium': true})).heading, contains('sticker'));
    });

    testWidgets('renders a PNG', (tester) async {
      final bytes = await tester.runAsync(
        () => etagSheetPng(EtagSheet(tag({'serial': 'S1'}))),
      );
      expect(bytes!.sublist(1, 4), 'PNG'.codeUnits);
    });
  });

  group('widgets', () {
    Widget host(Widget child, {List<String>? visited}) => MaterialApp.router(
      routerConfig: GoRouter(
        routes: [
          GoRoute(
            path: '/',
            builder: (_, _) => Scaffold(body: ListView(children: [child])),
          ),
          GoRoute(
            path: '/shop',
            builder: (_, s) {
              visited?.add(s.uri.toString());
              return const Text('shop');
            },
          ),
        ],
      ),
    );

    testWidgets('card shows Call Used, locked note and Buy Premium Tag', (
      tester,
    ) async {
      final visited = <String>[];
      await tester.pumpWidget(
        host(
          TagCard(tag: tag({'freeContactUsed': true, 'missedContacts': 2})),
          visited: visited,
        ),
      );
      expect(find.text('Call Used'), findsOneWidget);
      expect(find.textContaining('2 people tried'), findsOneWidget);
      await tester.tap(find.text('Buy Premium Tag'));
      await tester.pumpAndSettle();
      expect(visited, ['/shop?replaceTagId=t1&variant=Car']);
    });

    testWidgets('premium card has no buy action', (tester) async {
      await tester.pumpWidget(host(TagCard(tag: tag({'premium': true}))));
      expect(find.text('Premium'), findsOneWidget);
      expect(find.text('Buy Premium Tag'), findsNothing);
    });

    testWidgets('membership card shows days left and a bar', (tester) async {
      final end = DateTime.now().add(const Duration(days: 30, hours: 1));
      await tester.pumpWidget(
        host(
          MembershipStatusCard(
            tag: tag({
              'premium': true,
              'membership': {
                'state': 'trial',
                'endsAt': end.toUtc().toIso8601String(),
                'daysLeft': 31,
                'totalDays': 365,
                'elapsedDays': 334,
              },
            }),
          ),
        ),
      );
      expect(find.text('31 days left'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
    });

    testWidgets('vehicle info lists tag id and serial', (tester) async {
      await tester.pumpWidget(
        host(
          VehicleInfoCard(
            tag: tag({'serial': 'S-9', 'etagId': 'PT-X1'}),
            owner: Owner.fromJson({
              'displayName': 'Asha',
              'mobile': '+919800000000',
            }),
          ),
        ),
      );
      expect(find.text('tokAAAAAAAAA'), findsOneWidget);
      expect(find.text('S-9'), findsOneWidget);
      expect(find.text('Asha'), findsOneWidget);
    });

    testWidgets('contact page opens the scan URL in a Custom Tab', (
      tester,
    ) async {
      final opened = <String>[];
      tagCustomTab = (u) async {
        opened.add(u);
        return true;
      };
      await tester.pumpWidget(host(ContactPageTile(tag: tag({}))));
      await tester.tap(find.text('View contact page'));
      await tester.pump();
      expect(opened, ['https://app.parktag.me/tag/tokAAAAAAAAA']);
    });

    testWidgets('Test SOS explains how to test', (tester) async {
      final t = tag({'emergencyContact': '+919811111111'});
      await tester.pumpWidget(
        host(
          Builder(
            builder: (c) => TextButton(
              onPressed: () => showSosTest(c, t),
              child: const Text('go'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();
      expect(find.textContaining('+919811111111'), findsOneWidget);
      expect(find.textContaining('Emergency button'), findsOneWidget);
    });
  });
}
