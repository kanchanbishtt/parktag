// The web shop's product table (welcome-shop.js PRODUCTS), in its on-screen
// order: combo before bike so the two photographic thumbnails sit on opposite
// corners of the grid. The server's price list only overrides what a card
// shows; which packs exist, their copy and their artwork live here, as on
// the web.

import 'models.dart';

class CatalogueItem {
  const CatalogueItem({
    required this.id,
    required this.name,
    required this.desc,
    required this.features,
    required this.price,
    required this.orig,
    required this.discount,
    required this.variants,
    required this.asset,
    required this.assetDesktop,
    this.soldOut = false,
  });

  final String id;
  final String name;
  final String desc;
  final List<String> features;

  /// Rupees, the first paint before `/api/shop/pricing` answers.
  final int price;
  final int orig;
  final int discount;
  final List<String> variants;
  final String asset;

  /// The 16:9 crop the page shows from 1024px (`imageDesktop`).
  final String assetDesktop;

  /// Out of stock, not withdrawn: shown at its price with no way to buy it.
  final bool soldOut;
}

const _features = [
  'Masked Calls',
  'WhatsApp',
  'Emergency Contact',
  'One time buy',
];

const shopCatalogue = [
  CatalogueItem(
    id: 'pt-car-1',
    name: 'ParkTag Car Tag (Pack of 1)',
    desc: 'Allow people to contact you in case of urgency with parked vehicle.',
    features: _features,
    price: 299,
    orig: 499,
    discount: 40,
    variants: ['Car', 'Auto'],
    asset: 'assets/shop/shop-car-900.webp',
    assetDesktop: 'assets/shop/shop-car-desktop.webp',
  ),
  CatalogueItem(
    id: 'pt-car-2',
    name: 'ParkTag Car Tag (Pack of 2)',
    desc: 'Best value: tag two cars and never miss an emergency call.',
    features: _features,
    price: 499,
    orig: 799,
    discount: 38,
    variants: ['Car', 'Auto'],
    asset: 'assets/shop/shop-car-2-v2-900.webp',
    assetDesktop: 'assets/shop/shop-car-2-v2-desktop.webp',
  ),
  CatalogueItem(
    id: 'pt-combo',
    name: 'ParkTag Combo Tag (Pack of 2)',
    desc: 'Car + Bike tags: the complete bundle for your entire fleet.',
    features: _features,
    price: 499,
    orig: 899,
    discount: 44,
    variants: ['Car', 'Bike', 'Scooter'],
    asset: 'assets/shop/shop-combo-900.webp',
    assetDesktop: 'assets/shop/shop-combo-desktop.webp',
    soldOut: true,
  ),
  CatalogueItem(
    id: 'pt-bike-1',
    name: 'ParkTag Bike Tag (Pack of 2)',
    desc: 'Front and back of one two-wheeler: weatherproof stickers with QR contact.',
    features: _features,
    price: 499,
    orig: 799,
    discount: 38,
    variants: ['Bike', 'Scooter', 'Helmet'],
    asset: 'assets/shop/shop-bike-v2-900.webp',
    assetDesktop: 'assets/shop/shop-bike-desktop.webp',
    soldOut: true,
  ),
];

/// welcome-shop.js cardPrice(): the rupees a card or the sheet shows. With a
/// website offer the struck price is the real MRP and [code] names the offer;
/// otherwise the server's list price, or the table above until it answers.
({int price, int orig, int discount, String? code}) cardPrice(
  CatalogueItem p,
  Pricing? pricing,
) {
  final product = pricing?.productFor(p.id);
  final offer = product?.offer;
  if (offer != null && offer.mrpPaise > 0) {
    return (
      price: (offer.offerPaise / 100).round(),
      orig: (offer.mrpPaise / 100).round(),
      discount: (offer.discountPaise / offer.mrpPaise * 100).round(),
      code: offer.code,
    );
  }
  return (
    price: product != null ? (product.amountPaise / 100).round() : p.price,
    orig: p.orig,
    discount: p.discount,
    code: null,
  );
}
