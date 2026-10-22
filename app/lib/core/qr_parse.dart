const tagHost = 'app.parktag.me';
final _pathToken = RegExp(r'^/(tag|vehicle)/([A-Za-z0-9]{12,64})/?$');
final _bareToken = RegExp(r'^[A-Za-z0-9]{12,64}$');
final _barePath = RegExp(r'^/(tag|vehicle)/?$');

/// Returns the tag token from a scanned or linked ParkTag URL, or null.
/// Strict: https, exactly app.parktag.me, no userinfo, no custom port.
/// The raw string is never launched, and the token is never logged.
String? parseTagUrl(String raw) {
  final uri = Uri.tryParse(raw.trim());
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.host != tagHost ||
      uri.userInfo.isNotEmpty ||
      (uri.hasPort && uri.port != 443)) {
    return null;
  }
  final match = _pathToken.firstMatch(uri.path);
  if (match != null) return match.group(2);
  if (!_barePath.hasMatch(uri.path)) return null;
  try {
    final token = uri.queryParameters['token'];
    return token != null && _bareToken.hasMatch(token) ? token : null;
  } on FormatException {
    return null;
  }
}
