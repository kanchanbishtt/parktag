import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import '../../core/platform.dart';
import '../../core/web_layout.dart';
import '../../core/web_text.dart';
import '../../core/widgets.dart';
import '../owner/home_web.dart';
import '../owner/owner_common.dart' show showError;
import 'cart_store.dart';
import 'catalogue.dart';
import 'checkout.dart';
import 'models.dart';
import 'shop_web.dart';

/// The web storefront a guest buys on: its checkout needs reCAPTCHA and
/// takes no account, so the app opens it in a Custom Tab from BUY NOW.
const guestShopUrl = 'https://app.parktag.me/get';

/// `/shop`: the web owner dashboard's Shop view (welcome.html #view-shop)
/// under the same header as Home: the heading, the four packs in two columns,
/// and the product sheet a card opens. Physical stickers only.
///
/// A guest sees the same view under the storefront's header (a Sign in pill
/// in place of the greeting); BUY NOW then opens the web storefront.
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
  late Future<Pricing> _future;
  Pricing? _pricing;
  Object? _error;

  /// Spent by the first order, as the web nulls window._replaceTagId, so a
  /// second order from this screen does not replace the same trial tag.
  late String? _replaceTagId = widget.replaceTagId;

  bool _restored = false;

  bool get _owner => AppScope.read(context).isOwner;

  @override
  void initState() {
    super.initState();
    _future = _load();
    // The header greets by name from the dashboard; the grid does not wait
    // for it (the web paints the local product table first too).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final app = AppScope.read(context);
      if (app.isOwner && app.dashboard == null) {
        app.refresh().catchError((_) {});
      }
    });
  }

  Future<Pricing> _load() async {
    final api = AppScope.read(context).api;
    // Same catalogue and offers either way; the owner route needs a session.
    final path = _owner ? '/api/shop/pricing' : '/api/shop/public-catalogue';
    try {
      final pricing = Pricing.fromJson(await api.get(path));
      if (mounted) {
        setState(() {
          _pricing = pricing;
          _error = null;
        });
      }
      if (!_restored && _owner) {
        _restored = true;
        _restore(pricing);
      }
      return pricing;
    } catch (e) {
      if (mounted) setState(() => _error = e);
      rethrow;
    }
  }

  Future<void> _reload() async {
    setState(() => _future = _load());
    try {
      await _future;
    } catch (_) {
      // Shown in the ErrorCard above the grid.
    }
  }

  /// Reopens a checkout the app was killed in the middle of.
  Future<void> _restore(Pricing pricing) async {
    final cart = await readCart();
    if (cart == null || !mounted) return;
    final p = pricing.products.where(
      (p) => p.id == cart.productId && !p.soldOut,
    );
    if (p.isEmpty) return clearCart();
    // A replace link wins over whatever was in the cart before it.
    if (_replaceTagId != null && _replaceTagId != cart.replaceTagId) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _open(p.first, pricing, cart: cart);
    });
  }

  /// The web's product sheet; BUY NOW goes on to the pack step.
  void _show(CatalogueItem item) {
    showProductSheet(
      context,
      item: item,
      pricing: _pricing,
      initialVariant: widget.variant,
      onBuy: (sheet, variant) async {
        Navigator.of(sheet).pop();
        if (!_owner) {
          PtPlatform.openCustomTab(guestShopUrl);
          return;
        }
        var pricing = _pricing;
        if (pricing == null) {
          // Tapped before the price list arrived (or after it failed).
          try {
            pricing = await _load();
          } catch (e) {
            if (mounted) showError(context, e);
            return;
          }
        }
        if (!mounted) return;
        final product =
            pricing.productFor(item.id) ??
            Product(item.id, item.name, item.price * 100);
        _open(product, pricing, variant: variant);
      },
    );
  }

  void _open(Product p, Pricing pricing, {SavedCart? cart, String? variant}) {
    ModalRoute<void>? sheetRoute;
    showPtSheet<void>(
      context,
      builder: (sheet) {
        sheetRoute = ModalRoute.of(sheet);
        return CheckoutSheet(
          product: p,
          pricing: pricing,
          initialQuantity: cart?.quantity ?? 1,
          initialVariant: cart?.variant ?? variant ?? widget.variant,
          replaceTagId: cart?.replaceTagId ?? _replaceTagId,
          onAddress: (current) =>
              context.push<Address>('/shop/address', extra: current),
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
    final error = _error;
    final owner = AppScope.of(context).isOwner;
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: EdgeInsets.zero,
          children: [
            if (owner) const HomeHeader() else const GuestHeader(),
            WebContent(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const ShopHeading(),
                  if (error != null && _pricing == null)
                    Padding(
                      padding: const EdgeInsets.only(top: 14),
                      child: ErrorCard.from(error, onRetry: _reload),
                    ),
                  ShopGrid(pricing: _pricing, onOpen: _show),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The storefront's header (`/get`, `.gt-header`): the logo and a "Sign in"
/// pill on navy, 64px tall at phone width.
class GuestHeader extends StatelessWidget {
  const GuestHeader({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF0B132B),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: Row(
            children: [
              const PtLogo(height: 38, onDark: true),
              const Spacer(),
              Material(
                color: Colors.transparent,
                shape: const StadiumBorder(
                  side: BorderSide(color: Color(0x59FFFFFF)),
                ),
                child: InkWell(
                  customBorder: const StadiumBorder(),
                  onTap: () => context.go('/login'),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    child: Text(
                      'Sign in',
                      style: wt(
                        13.12,
                        weight: FontWeight.w600,
                        color: Colors.white,
                        height: 1.2,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
