// Shop models. Amounts are paise everywhere, as the server sends them.

import '../../core/api.dart' show apiBase;

/// `29900` -> `₹299`, `29950` -> `₹299.50`.
String formatRupees(int paise) {
  final sign = paise < 0 ? '-' : '';
  final abs = paise.abs();
  final rupees = abs ~/ 100;
  final rest = abs % 100;
  return rest == 0
      ? '$sign₹$rupees'
      : '$sign₹$rupees.${rest.toString().padLeft(2, '0')}';
}

int _int(Object? v) => v is num ? v.toInt() : 0;
String _str(Object? v) => v is String ? v : '';
Map<String, dynamic> _map(Object? v) =>
    v is Map<String, dynamic> ? v : const {};

class Product {
  const Product(this.id, this.name, this.amountPaise,
      {this.soldOut = false, this.offerByQuantity = const []});

  final String id;
  final String name;
  final int amountPaise;
  final bool soldOut;

  /// The website offer's payable total for quantity 1, 2, ... (empty: no offer).
  final List<int> offerByQuantity;

  /// What [quantity] packs cost before any typed code.
  int payableFor(int quantity) => quantity <= offerByQuantity.length
      ? offerByQuantity[quantity - 1]
      : amountPaise * quantity;
}

/// The storefront photo the web shop uses for [productId] (welcome-shop.js
/// PRODUCTS). The 2-car pack and the bike add-on SKUs have no photo of their
/// own on the web, so they borrow the nearest one.
String? productImageUrl(String productId) {
  final file = switch (productId) {
    'pt-car-1' => 'shop-car-900.webp',
    'pt-car-2' || 'pt-car-4' => 'shop-car-2-v2-900.webp',
    'pt-bike-1' => 'shop-bike-v2-900.webp',
    'pt-combo' || 'pt-car-1-bike' || 'pt-car-2-bike' || 'pt-car-4-bike' =>
      'shop-combo-900.webp',
    _ => null,
  };
  return file == null ? null : '$apiBase/images/$file';
}

/// The labels the server records on an order (SHOP_VARIANTS, shapeVariant).
const shopVariants = {'Car', 'Auto', 'Bike', 'Scooter', 'Helmet'};

/// The variant choices the web shows for a pack, first one preselected.
List<String> variantsFor(String productId) {
  if (productId == 'pt-bike-1') return const ['Bike', 'Scooter', 'Helmet'];
  if (productId == 'pt-combo' || productId.endsWith('-bike')) {
    return const ['Car', 'Bike', 'Scooter'];
  }
  return const ['Car', 'Auto'];
}

/// A tag id from a tag screen link: a Mongo ObjectId or nothing.
String? parseReplaceTagId(String? raw) =>
    raw != null && RegExp(r'^[a-fA-F0-9]{24}$').hasMatch(raw) ? raw : null;

/// `GET /api/shop/pricing`.
class Pricing {
  const Pricing(this.products,
      {this.codSurchargePaise = 0, this.flashDiscountPaise = 0});

  factory Pricing.fromJson(Map<String, dynamic> json) {
    final offers = _map(json['offers']);
    final products = <Product>[];
    _map(json['products']).forEach((id, raw) {
      final p = _map(raw);
      final offer = _map(offers[id]);
      final byQty = offer['payableByQuantity'];
      products.add(Product(id, _str(p['name']), _int(p['amountPaise']),
          soldOut: p['soldOut'] == true,
          offerByQuantity: byQty is List ? [for (final v in byQty) _int(v)] : const []));
    });
    return Pricing(products,
        codSurchargePaise: _int(json['codSurchargePaise']),
        flashDiscountPaise: _int(json['flashDiscountPaise']));
  }

  final List<Product> products;
  final int codSurchargePaise;
  final int flashDiscountPaise;
}

/// The owner's delivery address (`/api/owner/address`).
class Address {
  const Address({
    this.fullName = '',
    this.phone = '',
    this.line1 = '',
    this.line2 = '',
    this.landmark = '',
    this.city = '',
    this.state = '',
    this.pincode = '',
  });

  factory Address.fromJson(Map<String, dynamic> j) => Address(
        fullName: _str(j['fullName']),
        phone: _str(j['phone']),
        line1: _str(j['line1']),
        line2: _str(j['line2']),
        landmark: _str(j['landmark']),
        city: _str(j['city']),
        state: _str(j['state']),
        pincode: _str(j['pincode']),
      );

  final String fullName, phone, line1, line2, landmark, city, state, pincode;

  Map<String, dynamic> toJson() => {
        'fullName': fullName,
        'phone': phone,
        'line1': line1,
        'line2': line2,
        'landmark': landmark,
        'city': city,
        'state': state,
        'pincode': pincode,
      };

  String get oneLine => [line1, line2, landmark, city, state, pincode]
      .where((s) => s.isNotEmpty)
      .join(', ');
}

/// A row of `GET /api/owner/orders`.
class ShopOrder {
  const ShopOrder(this.id, this.orderNumber, this.productName, this.amountPaise,
      this.cod, this.status, this.orderedAt, {this.trackable = false});

  factory ShopOrder.fromJson(Map<String, dynamic> j) => ShopOrder(
        _str(j['id']),
        _str(j['orderNumber']),
        _str(j['productName']),
        _int(j['amount']),
        j['paymentMethod'] == 'cod',
        _str(j['shippingStatus']),
        DateTime.tryParse(_str(j['orderedAt'])),
        // Only orders with a waybill have a courier timeline.
        trackable: j['trackable'] == true,
      );

  final String id, orderNumber, productName;
  final int amountPaise;
  final bool cod, trackable;
  final String status;
  final DateTime? orderedAt;
}

/// One checkpoint of `GET /api/owner/orders/:id/track`.
class TrackScan {
  const TrackScan(this.status, this.dateTime, this.location, this.instructions);

  factory TrackScan.fromJson(Map<String, dynamic> j) => TrackScan(_str(j['status']),
      DateTime.tryParse(_str(j['dateTime'])), _str(j['location']), _str(j['instructions']));

  final String status, location, instructions;
  final DateTime? dateTime;
}

/// Server shipping status codes in words.
String shippingLabel(String status) => switch (status) {
      'processing' => 'Processing',
      'cod_confirmed' => 'Confirmed, pay on delivery',
      'booked' => 'Courier booked',
      'booking_failed' => 'Shipping delayed, we are on it',
      '' => 'Processing',
      _ => status,
    };

/// What the confirmation screen needs.
class OrderConfirmation {
  const OrderConfirmation(this.orderNumber,
      {this.cod = false, this.flashSeconds = 0, this.flashDiscountPaise = 0});

  final String orderNumber;
  final bool cod;
  final int flashSeconds;
  final int flashDiscountPaise;
}

String shortDate(DateTime d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final l = d.toLocal();
  final hh = l.hour.toString().padLeft(2, '0');
  final mm = l.minute.toString().padLeft(2, '0');
  return '${l.day} ${months[l.month - 1]}, $hh:$mm';
}
