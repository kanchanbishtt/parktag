import 'package:app/features/scan/scanner_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('scanner renders with no camera available', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: ScannerScreen()));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Scan'), findsOneWidget);
    expect(find.text('Point the camera at the QR on the ParkTag sticker.'),
        findsOneWidget);
  });

  testWidgets('scanner stays idle on a hidden tab', (tester) async {
    await tester.pumpWidget(const MaterialApp(
        home: TickerMode(enabled: false, child: ScannerScreen())));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Scan'), findsOneWidget);
  });
}
