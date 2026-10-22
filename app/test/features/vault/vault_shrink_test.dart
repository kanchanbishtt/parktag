import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:app/features/vault/models.dart';
import 'package:app/features/vault/vault_shrink.dart';
import 'package:flutter_test/flutter_test.dart';

Uint8List _bytes(int n) => Uint8List(n)..fillRange(0, n, 1);

void main() {
  final big = _bytes(maxUploadBytes + 1);

  test('only JPG, PNG and WEBP are shrinkable', () {
    expect(isShrinkableImage('a.PNG'), isTrue);
    expect(isShrinkableImage('a.webp'), isTrue);
    expect(isShrinkableImage('a.jpeg'), isTrue);
    expect(isShrinkableImage('a.pdf'), isFalse);
    expect(isShrinkableImage('a.heic'), isFalse);
  });

  test('stops at the first rung under 5MB and renames to .png', () async {
    final edges = <int>[];
    final s = await shrinkToFit(
      big,
      'rc front.webp',
      encode: (_, edge) async {
        edges.add(edge);
        return _bytes(edge == 1400 ? 1000 : maxUploadBytes + 1);
      },
    );
    expect(edges, [1600, 1400]);
    expect(s!.bytes.length, 1000);
    expect(s.filename, 'rc front.png');
  });

  test('null when nothing fits, encode fails, or file is a PDF', () async {
    expect(
      await shrinkToFit(big, 'a.png', encode: (_, _) async => big),
      isNull,
    );
    expect(
      await shrinkToFit(big, 'a.png', encode: (_, _) async => null),
      isNull,
    );
    expect(
      await shrinkToFit(big, 'a.png', encode: (_, _) => throw StateError('x')),
      isNull,
    );
    var called = false;
    await shrinkToFit(
      big,
      'a.pdf',
      encode: (_, _) async {
        called = true;
        return _bytes(1);
      },
    );
    expect(called, isFalse);
  });

  test('refuses to decode anything over 40MB', () async {
    var called = false;
    final r = await shrinkToFit(
      Uint8List(maxDecodeBytes + 1),
      'a.png',
      encode: (_, _) async {
        called = true;
        return _bytes(1);
      },
    );
    expect(r, isNull);
    expect(called, isFalse);
  });

  testWidgets('encodePng scales the long edge down, never up', (tester) async {
    await tester.runAsync(() async {
      final rec = ui.PictureRecorder();
      ui.Canvas(rec).drawRect(
        const ui.Rect.fromLTWH(0, 0, 400, 200),
        ui.Paint()..color = const ui.Color(0xFF336699),
      );
      final img = await rec.endRecording().toImage(400, 200);
      final png = (await img.toByteData(format: ui.ImageByteFormat.png))!.buffer
          .asUint8List();

      Future<(int, int)> dims(Uint8List b) async {
        final c = await ui.instantiateImageCodec(b);
        final f = await c.getNextFrame();
        return (f.image.width, f.image.height);
      }

      expect(await dims((await encodePng(png, 100))!), (100, 50));
      expect(await dims((await encodePng(png, 1600))!), (400, 200));
    });
  });
}
