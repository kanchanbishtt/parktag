import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The open checkout, kept so an app kill mid-checkout reopens it, as the
/// web's _keepCheckout does with sessionStorage. Cleared when the sheet
/// closes and before Razorpay opens, so a restore never invites paying twice.
class SavedCart {
  const SavedCart(this.productId,
      {this.quantity = 1, this.variant, this.replaceTagId, this.savedAt});

  final String productId;
  final int quantity;
  final String? variant;
  final String? replaceTagId;
  final DateTime? savedAt;

  /// Older than this is a checkout the buyer walked away from.
  static const maxAge = Duration(hours: 24);

  Map<String, Object?> toJson() => {
        'productId': productId,
        'quantity': quantity,
        'variant': variant,
        'replaceTagId': replaceTagId,
        'savedAt': DateTime.now().toIso8601String(),
      };

  static SavedCart? fromJson(Object? j, {DateTime? now}) {
    if (j is! Map) return null;
    final id = j['productId'];
    final q = j['quantity'];
    final at = DateTime.tryParse('${j['savedAt']}');
    if (id is! String || id.isEmpty || at == null) return null;
    if ((now ?? DateTime.now()).difference(at) > maxAge) return null;
    return SavedCart(id,
        quantity: q is int && q >= 1 && q <= 20 ? q : 1,
        variant: j['variant'] is String ? j['variant'] as String : null,
        replaceTagId: j['replaceTagId'] is String ? j['replaceTagId'] as String : null,
        savedAt: at);
  }
}

const _key = 'pt_cart';
const _storage = FlutterSecureStorage();

Future<SavedCart?> readCart() async {
  try {
    final raw = await _storage.read(key: _key);
    return raw == null ? null : SavedCart.fromJson(jsonDecode(raw));
  } catch (_) {
    return null; // a corrupt entry is just no cart
  }
}

Future<void> writeCart(SavedCart cart) async {
  try {
    await _storage.write(key: _key, value: jsonEncode(cart.toJson()));
  } catch (_) {
    // Convenience only.
  }
}

Future<void> clearCart() async {
  try {
    await _storage.delete(key: _key);
  } catch (_) {}
}
