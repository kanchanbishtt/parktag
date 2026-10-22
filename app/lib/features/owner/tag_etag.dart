import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/models.dart';
import '../../core/theme.dart';

// The E-Tag print sheet from vehicle-detail.html #etag-print, drawn as a PNG
// the owner can share or save: fixing instructions on top, the cut-out
// sticker below with plate, E-Tag ID, status and serial.

/// What the sheet prints. Split out so tests can check the words.
class EtagSheet {
  EtagSheet(Tag t)
    : premium = t.premium,
      plate = t.plateNumber ?? '-',
      etagId = (t.etagId ?? '').replaceFirst(RegExp(r'^PT-'), ''),
      status = t.status == 'inactive' ? 'Inactive' : 'Active',
      serial = t.serial ?? '',
      qr = t.scanUrl;

  final bool premium;
  final String plate;
  final String etagId;
  final String status;
  final String serial;
  final String qr;

  String get intro => premium
      ? 'Thank you for purchasing your official ParkTag premium sticker.'
      : 'Thank you for generating your free ParkTag E-Tag.';

  String get heading => premium
      ? 'How to fix your sticker to the windscreen'
      : 'How to fix the E-Tag to your windscreen';

  static const steps = [
    '1. Print this page on a photo sheet or regular paper.',
    '2. Cut the tag along the dotted line.',
    '3. Apply glue (e.g., Feviglue) or transparent double-sided tape to the '
        'front of the tag, then place it on your dashboard or windscreen with '
        'the QR facing out.',
  ];

  String get freebox => premium
      ? 'This official ParkTag sticker unlocks unlimited private contact. '
            'Finders can always reach you via masked call or WhatsApp, and '
            'your number stays private.'
      : 'This free E-Tag includes 1 free masked call and unlimited WhatsApp '
            'alerts (your number stays private either way). For unlimited '
            'masked calls too, upgrade to the official physical ParkTag '
            'sticker.';

  String get etagLine =>
      'E-Tag ${etagId.isEmpty ? '-' : etagId}  ·  $plate  ·  $status';

  String get fileName =>
      'parktag-${plate.replaceAll(RegExp(r'[^A-Za-z0-9]'), '')}.png';
}

const _w = 1240.0;
const _h = 1240.0;

void _text(
  Canvas c,
  String s,
  Offset at, {
  double size = 26,
  Color color = PtColors.navy,
  FontWeight weight = FontWeight.w500,
  double maxWidth = _w - 160,
  TextAlign align = TextAlign.left,
}) {
  final p = TextPainter(
    text: TextSpan(
      text: s,
      style: TextStyle(
        fontSize: size,
        color: color,
        fontWeight: weight,
        height: 1.3,
      ),
    ),
    textAlign: align,
    textDirection: TextDirection.ltr,
  )..layout(maxWidth: maxWidth);
  p.paint(c, at);
}

double _measure(String s, double size, double maxWidth) {
  final p = TextPainter(
    text: TextSpan(
      text: s,
      style: TextStyle(fontSize: size, height: 1.3),
    ),
    textDirection: TextDirection.ltr,
  )..layout(maxWidth: maxWidth);
  return p.height;
}

/// Draws the sheet and returns PNG bytes.
Future<Uint8List> etagSheetPng(EtagSheet s) async {
  final rec = ui.PictureRecorder();
  final c = Canvas(
    rec,
  )..drawRect(const Rect.fromLTWH(0, 0, _w, _h), Paint()..color = Colors.white);

  var y = 70.0;
  _text(c, s.intro, Offset(80, y), size: 24, color: PtColors.muted);
  y += 44;
  _text(c, s.heading, Offset(80, y), size: 34, weight: FontWeight.w800);
  y += 60;
  for (final step in EtagSheet.steps) {
    _text(c, step, Offset(80, y), size: 24);
    y += _measure(step, 24, _w - 160) + 10;
  }
  y += 10;
  final boxH = _measure(s.freebox, 22, _w - 200) + 36;
  c.drawRRect(
    RRect.fromRectAndRadius(
      Rect.fromLTWH(80, y, _w - 160, boxH),
      const Radius.circular(16),
    ),
    Paint()..color = const Color(0xFFFFF1EE),
  );
  _text(c, s.freebox, Offset(100, y + 18), size: 22, maxWidth: _w - 200);
  y += boxH + 50;

  // Dotted cut line around the sticker.
  final sticker = Rect.fromLTWH(80, y, _w - 160, 520);
  final dash = Paint()
    ..color = PtColors.muted
    ..strokeWidth = 2;
  for (var x = sticker.left; x < sticker.right; x += 18) {
    c.drawLine(
      Offset(x, sticker.top - 14),
      Offset(x + 9, sticker.top - 14),
      dash,
    );
    c.drawLine(
      Offset(x, sticker.bottom + 14),
      Offset(x + 9, sticker.bottom + 14),
      dash,
    );
  }

  final half = sticker.width / 2;
  final left = Rect.fromLTWH(sticker.left, sticker.top, half, sticker.height);
  final right = Rect.fromLTWH(
    sticker.left + half,
    sticker.top,
    half,
    sticker.height,
  );
  c
    ..drawRect(left, Paint()..color = Colors.white)
    ..drawRect(
      left,
      Paint()
        ..color = PtColors.line
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2,
    )
    ..drawRect(right, Paint()..color = PtColors.accent);

  final lx = left.left + 36;
  final lw = half - 72;
  _text(
    c,
    'ParkTag',
    Offset(lx, left.top + 36),
    size: 44,
    weight: FontWeight.w900,
  );
  _text(
    c,
    'SCAN TO CONNECT',
    Offset(lx, left.top + 96),
    size: 18,
    color: PtColors.muted,
    weight: FontWeight.w700,
  );
  _text(
    c,
    'Scan the code to contact the vehicle owner.',
    Offset(lx, left.top + 150),
    size: 40,
    weight: FontWeight.w800,
    maxWidth: lw,
  );
  _text(
    c,
    'Scan using phone camera, Google Lens or any QR scanner app. Visit www.parktag.me for more.',
    Offset(lx, left.bottom - 150),
    size: 18,
    color: PtColors.muted,
    maxWidth: lw,
  );
  _text(
    c,
    s.etagLine,
    Offset(lx, left.bottom - 70),
    size: 20,
    weight: FontWeight.w700,
    maxWidth: lw,
  );

  const qrSize = 300.0;
  final qrBox = Rect.fromLTWH(
    right.center.dx - qrSize / 2 - 16,
    right.top + 36,
    qrSize + 32,
    qrSize + 32,
  );
  c.drawRRect(
    RRect.fromRectAndRadius(qrBox, const Radius.circular(16)),
    Paint()..color = Colors.white,
  );
  if (s.qr.isNotEmpty) {
    c
      ..save()
      ..translate(qrBox.left + 16, qrBox.top + 16);
    QrPainter(
      data: s.qr,
      version: QrVersions.auto,
      gapless: true,
    ).paint(c, const Size.square(qrSize));
    c.restore();
  }
  final rx = right.left + 30;
  final rw = half - 60;
  _text(
    c,
    'ParkTag.me  ·  vehicle tag',
    Offset(rx, qrBox.bottom + 20),
    size: 22,
    color: Colors.white,
    weight: FontWeight.w800,
    maxWidth: rw,
    align: TextAlign.center,
  );
  _text(
    c,
    'Wrong parking, emergency contact, any issue with the vehicle? Scan the QR.',
    Offset(rx, qrBox.bottom + 66),
    size: 18,
    color: Colors.white,
    maxWidth: rw,
    align: TextAlign.center,
  );
  if (s.serial.isNotEmpty) {
    _text(
      c,
      s.serial,
      Offset(rx, right.bottom - 40),
      size: 18,
      color: Colors.white,
      weight: FontWeight.w700,
      maxWidth: rw,
      align: TextAlign.center,
    );
  }

  final image = await rec.endRecording().toImage(_w.toInt(), _h.toInt());
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  return bytes!.buffer.asUint8List();
}
