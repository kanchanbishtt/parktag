import 'dart:async';

import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/platform.dart';

/// Side effects of the scan feature. Tests swap these out.
abstract final class ScanIo {
  /// `tel:` and other external hand-offs.
  static Future<bool> Function(Uri) launch = (uri) =>
      launchUrl(uri, mode: LaunchMode.externalApplication);

  /// Report-tag and other Custom Tabs (always `pt_app=android`).
  static Future<bool> Function(String) customTab = PtPlatform.openCustomTab;

  /// System share sheet for plain text. Throws when there is none.
  static Future<void> Function(String) shareText = PtPlatform.shareText;

  /// Limited-use App Check token for send-otp, or null when unavailable.
  static Future<String?> Function() appCheckToken = _appCheckToken;

  /// Raw position fixes of the car, best effort. Asks for location permission,
  /// so it runs only after the scanner turns sharing on or confirms SOS.
  /// Errors with [LocationDenied] when location is off or refused.
  static Stream<CarFix> Function() positions = _positions;
}

/// One position fix. [accuracy] is in metres.
class CarFix {
  const CarFix(this.lat, this.lng, this.accuracy);

  final double lat;
  final double lng;
  final int accuracy;

  /// The `carLocation` body the server reads (it keeps lat and lng only).
  Map<String, num> toJson() => {'lat': lat, 'lng': lng, 'accuracy': accuracy};
}

class LocationDenied implements Exception {
  const LocationDenied();
}

/// Web net-retry SLOW_AFTER_MS: when to say a request is still working.
const slowAfter = Duration(milliseconds: 3500);

/// Runs [onSlow] if [work] has not finished after [slowAfter].
Future<T> withSlowNotice<T>(Future<T> work, void Function() onSlow) async {
  final timer = Timer(slowAfter, onSlow);
  try {
    return await work;
  } finally {
    timer.cancel();
  }
}

Future<String?> _appCheckToken() async {
  try {
    return await FirebaseAppCheck.instance.getLimitedUseToken();
  } catch (_) {
    // No Firebase or Integrity failure: the server answers 400 and we use the bridge.
    return null;
  }
}

Stream<CarFix> _positions() async* {
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw const LocationDenied();
  }
  var permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied) {
    permission = await Geolocator.requestPermission();
  }
  if (permission != LocationPermission.whileInUse &&
      permission != LocationPermission.always) {
    throw const LocationDenied();
  }
  yield* Geolocator.getPositionStream(
    locationSettings: const LocationSettings(accuracy: LocationAccuracy.best),
  ).map((p) => CarFix(p.latitude, p.longitude, p.accuracy.round()));
}
