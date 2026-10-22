import 'dart:async';

import 'package:flutter/material.dart';

import 'scan_io.dart';

/// Web GOOD_FIX_M and FIX_WINDOW_MS (scanner/app.js wireShareCarLocation).
const goodFixM = 25;
const fixWindow = Duration(seconds: 12);

/// "Share where the car is". The first fix is usually a network guess and GPS
/// narrows it, so fixes are watched and the best one kept: done at [goodFixM],
/// or with whatever is best after [fixWindow]. A send mid-refinement carries
/// the best fix so far.
class CarLocation extends ChangeNotifier {
  CarLocation({Stream<CarFix> Function()? source})
    : _source = source ?? ScanIo.positions;

  final Stream<CarFix> Function() _source;
  StreamSubscription<CarFix>? _sub;
  Timer? _timer;

  CarFix? best;
  bool busy = false;
  bool denied = false;
  bool failed = false;

  /// On (switch shown on) while finding a fix or holding one.
  bool get on => busy || best != null;

  /// Sends wait only while nothing usable has arrived yet.
  bool get pending => busy && best == null;

  Map<String, num>? get json => best?.toJson();

  void start() {
    if (busy || best != null) return;
    busy = true;
    denied = false;
    failed = false;
    notifyListeners();
    _sub = _source().listen(
      (fix) {
        if (!busy) return;
        final b = best;
        if (b != null && fix.accuracy >= b.accuracy) return;
        best = fix;
        if (fix.accuracy > 0 && fix.accuracy <= goodFixM) return _finish();
        notifyListeners();
      },
      // Refused ends it; any other error ends it only with nothing usable yet.
      onError: (Object e) {
        if (e is LocationDenied || best == null) {
          _finish(denied: e is LocationDenied);
        }
      },
      onDone: _finish,
    );
    _timer = Timer(fixWindow, _finish);
  }

  /// A second tap takes it back: sharing stays the scanner's choice until sent.
  void clear() {
    _stop();
    busy = false;
    best = null;
    denied = false;
    failed = false;
    notifyListeners();
  }

  void _finish({bool denied = false}) {
    if (!busy) return;
    _stop();
    busy = false;
    this.denied = denied;
    failed = best == null && !denied;
    notifyListeners();
  }

  void _stop() {
    _sub?.cancel();
    _sub = null;
    _timer?.cancel();
    _timer = null;
  }

  String get title => busy
      ? 'Finding the car...'
      : best != null
      ? 'Car location added'
      : 'Share where the car is';

  String get subtitle {
    final b = best;
    if (busy) {
      return b == null
          ? 'Allow location when your phone asks'
          : 'Accurate to ~${b.accuracy} m, improving...';
    }
    if (b != null) return 'The owner sees the nearest landmark';
    if (denied) return 'Location is off. You can still message or call.';
    if (failed) return "Couldn't get a fix. Tap to try again.";
    return 'Helps the owner find it faster';
  }

  @override
  void dispose() {
    _stop();
    super.dispose();
  }
}

class ShareLocationTile extends StatelessWidget {
  const ShareLocationTile({
    super.key,
    required this.location,
    this.enabled = true,
  });

  final CarLocation location;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: location,
      builder: (context, _) => SwitchListTile(
        key: const Key('share-location'),
        contentPadding: EdgeInsets.zero,
        title: Text(location.title),
        subtitle: Text(location.subtitle),
        value: location.on,
        onChanged: !enabled || location.busy
            ? null
            : (on) => on ? location.start() : location.clear(),
      ),
    );
  }
}
