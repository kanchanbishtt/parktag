import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/qr_parse.dart';
import '../../core/theme.dart';

const notParkTagCode = 'This is not a ParkTag code.';

/// `/scan`. The camera permission is asked when the scanner first starts.
/// The scanned string is only ever parsed, never opened.
///
/// The shell keeps this tab mounted (indexedStack), so the camera runs only
/// while the tab is visible: go_router turns TickerMode off for hidden tabs.
class ScannerScreen extends StatefulWidget {
  const ScannerScreen({super.key});

  @override
  State<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<ScannerScreen> {
  final _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    autoStart: false,
  );
  bool _busy = false;
  bool _visible = false;
  String? _rejected;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final visible = TickerMode.valuesOf(context).enabled;
    if (visible == _visible) return;
    _visible = visible;
    _syncCamera();
  }

  /// Runs the camera only while the tab is visible and no tag is open.
  Future<void> _syncCamera() async {
    try {
      if (_visible && !_busy) {
        await _controller.start();
        // The tab may have been hidden while the camera was starting.
        if (mounted && (!_visible || _busy)) await _controller.stop();
      } else {
        await _controller.stop();
      }
    } on MobileScannerException {
      // Start already in flight, or not attached yet: that call re-checks.
      // Camera failures land in the controller state and the errorBuilder.
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_busy || !_visible) return;
    for (final code in capture.barcodes) {
      final raw = code.rawValue;
      if (raw == null) continue;
      final token = parseTagUrl(raw);
      if (token == null) {
        setState(() => _rejected = notParkTagCode);
        continue;
      }
      _busy = true;
      setState(() => _rejected = null);
      await _syncCamera();
      if (!mounted) return;
      await context.push('/t/$token');
      if (!mounted) return;
      _busy = false;
      await _syncCamera();
      return;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan')),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
            errorBuilder: (context, error) => const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Camera is unavailable. Allow camera access in Settings and try again.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white),
                ),
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 110,
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: PtColors.panel,
                borderRadius: BorderRadius.circular(PtRadii.r16),
                boxShadow: PtShadows.card,
              ),
              child: Text(
                _rejected ??
                    'Point the camera at the QR on the ParkTag sticker.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: _rejected != null ? PtColors.error : PtColors.ink,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
