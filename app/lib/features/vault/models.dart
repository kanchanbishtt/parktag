import 'dart:convert';
import 'dart:typed_data';

import 'package:http_parser/http_parser.dart';

import '../../core/api.dart';
import '../../core/models.dart';

/// Server allowlist (src/backend/lib/core/vault.js ALLOWED_MIME), keyed by extension.
const _types = {
  'pdf': 'application/pdf',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'webp': 'image/webp',
};

const maxUploadBytes = 5 * 1024 * 1024;
const tooBigMessage = 'Each document must be under 5MB.';
const badTypeMessage = 'Only PDF, JPG, PNG or WEBP files can be stored.';

/// `docType` values in server order, with their display names.
const docTypes = {
  'rc': 'RC',
  'insurance': 'Insurance',
  'puc': 'PUC',
  'licence': 'Driving licence',
  'other': 'Other',
};

String docTypeName(String type) => docTypes[type] ?? 'Document';

/// The part Content-Type for [filename], or null when the server would refuse it.
/// Without it the part goes as application/octet-stream and the server says 415.
MediaType? uploadMediaType(String filename) {
  final dot = filename.lastIndexOf('.');
  if (dot < 0) return null;
  final type = _types[filename.substring(dot + 1).toLowerCase()];
  return type == null ? null : MediaType.parse(type);
}

/// Client-side checks before any request. Returns an error message or null.
String? checkUpload(String filename, int size) {
  if (uploadMediaType(filename) == null) return badTypeMessage;
  if (size > maxUploadBytes) return tooBigMessage;
  if (size <= 0) return 'That file is empty. Choose another.';
  return null;
}

/// Upload failures. 409 server text can mention upgrades, so local copy is used.
String uploadErrorMessage(ApiError e) {
  switch (e.status) {
    case 409:
      return e.code == 'STORAGE_FULL'
          ? 'Your document storage is full. Delete a document to add another.'
          : 'This vehicle has no document slots left. Delete one to add another.';
    case 413:
      return tooBigMessage;
    case 415:
      return badTypeMessage;
  }
  return e.message;
}

/// A 429 shows the server text plus how long to wait.
String rateLimitMessage(ApiError e) {
  final wait = e.retryAfter;
  if (wait == null) return e.message;
  final s = wait.inSeconds;
  final when = s < 60 ? '$s seconds' : '${(s / 60).ceil()} minutes';
  return '${e.message} Wait $when.';
}

String formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

/// One row of `GET /api/owner/vault/documents`.
class VaultDoc {
  VaultDoc.fromJson(Map<String, dynamic> j)
    : id = j['id'] is String ? j['id'] as String : '',
      docType = j['docType'] is String ? j['docType'] as String : 'other',
      label = j['label'] is String ? j['label'] as String : '',
      mimeType = j['mimeType'] is String ? j['mimeType'] as String : '',
      size = j['size'] is num ? (j['size'] as num).toInt() : 0,
      thumb = thumbBytes(j['thumb']),
      createdAt = j['createdAt'] is String
          ? DateTime.tryParse(j['createdAt'] as String)?.toLocal()
          : null;

  final String id;
  final String docType;
  final String label;
  final String mimeType;
  final int size;

  /// Card preview the web stores at upload (a small JPEG data URI), or null.
  final Uint8List? thumb;
  final DateTime? createdAt;

  bool get isImage => mimeType.startsWith('image/');
  String get title => label.isEmpty ? docTypeName(docType) : label;
}

/// True when [path] sits under [cacheDir], i.e. a copy the picker made that
/// we may delete. Anything else may be the user's own file.
bool isPickerCopy(String path, String cacheDir) {
  if (path.isEmpty || cacheDir.isEmpty || path.contains('..')) return false;
  final root = cacheDir.endsWith('/') ? cacheDir : '$cacheDir/';
  return path.startsWith(root);
}

/// Decodes a `data:image/jpeg;base64,...` thumbnail. Anything else is null.
Uint8List? thumbBytes(Object? v) {
  const prefix = 'data:image/jpeg;base64,';
  if (v is! String || !v.startsWith(prefix)) return null;
  try {
    return base64Decode(v.substring(prefix.length));
  } on FormatException {
    return null;
  }
}

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// "3 Oct 2026", or empty when unknown.
String formatDate(DateTime? d) =>
    d == null ? '' : '${d.day} ${_months[d.month - 1]} ${d.year}';

// Fallbacks match web documents.js when status had no limits.
const _defaultQuotaBytes = 40 * 1024 * 1024;
const _defaultPremiumDocs = 3;

/// Whole days left on the free period, rounded up so the last partial day
/// reads "1 day" (documents.js trialDaysLeft). Null when there is no trial.
int? trialDaysLeft(VaultEntitlement? e, DateTime now) {
  final end = e?.trialEndsAt;
  if (end == null) return null;
  final ms = end.difference(now).inMilliseconds;
  if (ms <= 0) return 0;
  return (ms / Duration.millisecondsPerDay).ceil();
}

/// Null when the server sent no entitlement: then the server decides on upload.
int? maxDocsFor(VaultEntitlement? e) => e?.maxDocs;

bool isVehicleFull(int count, VaultEntitlement? e) {
  final max = maxDocsFor(e);
  return max != null && count >= max;
}

String _docs(int n) => '$n document${n == 1 ? '' : 's'}';

/// "2 of 3 documents on this vehicle · using 1.2 MB of 40 MB".
String vaultTally(
  int count,
  int usedBytes,
  VaultEntitlement? e,
  VaultLimits? limits,
) {
  final max = maxDocsFor(e);
  var tally = '${_docs(count)} on this vehicle';
  if (max != null) {
    tally = count > max
        ? "$tally · this tag's allowance is $max"
        : '$count of ${_docs(max)} on this vehicle';
  }
  final quota = (limits != null && limits.maxBytesPerOwner > 0)
      ? limits.maxBytesPerOwner
      : _defaultQuotaBytes;
  return '$tally · using ${formatBytes(usedBytes)} of '
      '${(quota / (1024 * 1024)).round()} MB';
}

int _premiumDocs(VaultLimits? l) => l?.tiers['premium'] ?? _defaultPremiumDocs;

/// Copy for the card that replaces Add document once the vehicle is full.
/// No upgrade or subscribe prompt (Play policy), unlike web fullCard.
String fullCardBody(VaultEntitlement e) {
  final held = _docs(e.maxDocs);
  return e.premium
      ? 'This tag keeps $held for this vehicle. Delete one to add another.'
      : 'Your E-Tag keeps $held for this vehicle. Delete one to add another.';
}

/// Read-only note on the premium free period and what the allowance drops to.
/// Null outside a trial. [full] uses the web fullCard wording.
String? trialNote(
  VaultEntitlement? e,
  VaultLimits? limits,
  DateTime now, {
  bool full = false,
}) {
  if (e == null || !e.premium) return null;
  final days = trialDaysLeft(e, now);
  if (days == null) return null;
  final left = '$days day${days == 1 ? '' : 's'}';
  final after =
      'After that this vehicle keeps ${_premiumDocs(limits)} documents.';
  return full
      ? 'Your free period has $left left. $after Everything saved here stays, '
            "you just won't be able to add more."
      : 'Free with your premium tag for another $left. $after '
            'Nothing already saved is removed.';
}
