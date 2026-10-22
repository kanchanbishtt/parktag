import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'cart_store.dart';
import 'checkout.dart';
import 'models.dart';

/// `/shop`: the signed-in catalogue. Physical stickers only.
///
/// `/shop?replaceTagId=<tag id>&variant=Car` comes from an expired free-trial
/// tag: the order then mints a premium tag for that vehicle (web M18).
class ShopScreen extends StatefulWidget {
  const ShopScreen({super.key, this.replaceTagId, this.variant});

  final String? replaceTagId;
  final String? variant;

  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> {
  late Future<Pricing> _future = _load();

  /// Spent by the first order, as the web nulls window._replaceTagId, so a
  /// second order from this screen does not replace the same trial tag.
  late String? _replaceTagId = widget.replaceTagId;

  bool _restored = false;

  Future<Pricing> _load() async {
    final pricing =
        Pricing.fromJson(await AppScope.read(context).api.get('/api/shop/pricing'));
    if (!_restored) {
      _restored = true;
      _restore(pricing);
    }
    return pricing;
  }

  /// Reopens a checkout the app was killed in the middle of.
  Future<void> _restore(Pricing pricing) async {
    final cart = await readCart();
    if (cart == null || !mounted) return;
    final p = pricing.products.where((p) => p.id == cart.productId && !p.soldOut);
    if (p.isEmpty) return clearCart();
    // A replace link wins over whatever was in the cart before it.
    if (_replaceTagId != null && _replaceTagId != cart.replaceTagId) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _open(p.first, pricing, cart: cart);
    });
  }

  void _open(Product p, Pricing pricing, {SavedCart? cart}) {
    ModalRoute<void>? sheetRoute;
    showPtSheet<void>(
      context,
      builder: (sheet) {
        sheetRoute = ModalRoute.of(sheet);
        return CheckoutSheet(
          product: p,
          pricing: pricing,
          initialQuantity: cart?.quantity ?? 1,
          initialVariant: cart?.variant ?? widget.variant,
          replaceTagId: cart?.replaceTagId ?? _replaceTagId,
          onAddress: (current) => context.push<Address>('/shop/address', extra: current),
          // The sheet may already be gone (drag dismiss mid-request). The
          // order is placed either way, so always show the confirmation.
          onDone: (confirmation) {
            final route = sheetRoute;
            if (route != null && route.isCurrent) route.navigator?.pop();
            if (!mounted) return;
            // The replaced free tag leaves the dashboard once the order lands.
            if ((cart?.replaceTagId ?? _replaceTagId) != null) {
              AppScope.read(context).refresh().catchError((_) {});
            }
            setState(() => _replaceTagId = null);
            context.push('/shop/confirmed', extra: confirmation);
          },
        );
      },
    ).whenComplete(clearCart); // closed or ordered: nothing to reopen
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Shop'),
        actions: [
          TextButton.icon(
            onPressed: () => context.push('/shop/orders'),
            style: TextButton.styleFrom(foregroundColor: Colors.white),
            icon: const Icon(Icons.local_shipping_outlined),
            label: const Text('My orders'),
          ),
        ],
      ),
      body: FutureBuilder<Pricing>(
        future: _future,
        builder: (context, snap) {
          const pad = EdgeInsets.fromLTRB(PtLayout.padX, PtLayout.padX, PtLayout.padX, 110);
          if (snap.hasError) {
            return ListView(padding: pad, children: [
              ErrorCard.from(snap.error!,
                  onRetry: () => setState(() => _future = _load())),
            ]);
          }
          if (!snap.hasData) return const Padding(padding: pad, child: Skeleton());
          final pricing = snap.data!;
          return ListView(
            padding: pad,
            children: [
              Text(
                  _replaceTagId != null
                      ? 'Pick a pack for your premium tag. $replaceNote'
                      : 'ParkTag stickers, delivered to your door.',
                  style: const TextStyle(color: PtColors.muted)),
              const SizedBox(height: 12),
              for (final p in pricing.products) ...[
                _ProductCard(p, onTap: p.soldOut ? null : () => _open(p, pricing)),
                const SizedBox(height: 12),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard(this.p, {this.onTap});

  final Product p;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final price = p.payableFor(1);
    final discounted = price < p.amountPaise;
    return Opacity(
      opacity: p.soldOut ? 0.5 : 1,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                _Photo(p.id),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(p.name,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 4),
                      p.soldOut
                          ? const Text('Sold out', style: TextStyle(color: PtColors.muted))
                          : Row(children: [
                              Text(formatRupees(price),
                                  style: const TextStyle(
                                      fontSize: 16, fontWeight: FontWeight.w800)),
                              if (discounted) ...[
                                const SizedBox(width: 8),
                                Text(formatRupees(p.amountPaise),
                                    style: const TextStyle(
                                        color: PtColors.muted,
                                        decoration: TextDecoration.lineThrough)),
                              ],
                            ]),
                    ],
                  ),
                ),
                if (!p.soldOut) const Icon(Icons.chevron_right),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The web storefront's photo, or the QR icon while loading or on failure.
class _Photo extends StatelessWidget {
  const _Photo(this.productId);

  final String productId;

  static const _size = 72.0;
  static const _icon = SizedBox.square(
      dimension: _size,
      child: Icon(Icons.qr_code_2_rounded, size: 36, color: PtColors.navy));

  @override
  Widget build(BuildContext context) {
    final url = productImageUrl(productId);
    if (url == null) return _icon;
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Image.network(url,
          width: _size,
          height: _size,
          fit: BoxFit.cover,
          cacheWidth: 216,
          errorBuilder: (_, _, _) => _icon,
          loadingBuilder: (_, child, progress) => progress == null ? child : _icon),
    );
  }
}
