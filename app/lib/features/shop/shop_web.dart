// The web dashboard's Shop view (welcome.html #view-shop, owner-welcome.css
// "Shop grid", "Shop: responsive" and "Product detail sheet"), drawn to its
// measurements at every breakpoint: the heading, the two-column product grid
// and the product sheet a card opens. Sizes are the stylesheet's rem values
// in px; line heights are the boxes Chrome lays the same text out in.

import 'package:flutter/material.dart';

import '../../core/web_text.dart';
import 'catalogue.dart';
import 'models.dart';

abstract final class _C {
  static const red = Color(0xFFFF2700);
  static const redDark = Color(0xFFD92200);
  static const slate = Color(0xFF374151);
  static const grey = Color(0xFF6B7280);
  static const grey400 = Color(0xFF9CA3AF);
  static const line = Color(0xFFE5E7EB);
  static const imgBg = Color(0xFFF3F4F6);
  static const outBg = Color(0xFFF9FAFB);
}

/// The stylesheet switches to the 16:9 desktop artwork, bigger names and a
/// wider gap at this viewport width (PT_SHOP_DESKTOP_MQ in welcome-shop.js).
const _desktopWidth = 1024.0;

/// `.pt-shop-hd`: "Shop", the red bar and the one-line sub.
class ShopHeading extends StatelessWidget {
  const ShopHeading({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Shop',
            style: wt(20.8, weight: FontWeight.w900, height: 27 / 20.8),
          ),
          const SizedBox(height: 5),
          Container(
            width: 34,
            height: 3,
            decoration: BoxDecoration(
              color: _C.red,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 7),
          Text(
            'Get your ParkTag physical tag delivered to you.',
            style: wt(14.08, color: _C.grey, height: 19 / 14.08),
          ),
        ],
      ),
    );
  }
}

/// `.pt-shop-grid`: two columns at every width; only the gap and the type
/// scale change with the viewport (the stylesheet's 480, 640 and 1024
/// breakpoints). Cards in a row stretch to the taller one, as grid items do.
class ShopGrid extends StatelessWidget {
  const ShopGrid({super.key, required this.pricing, required this.onOpen});

  /// Null until `/api/shop/pricing` answers: the cards show the table prices.
  final Pricing? pricing;
  final void Function(CatalogueItem item) onOpen;

  @override
  Widget build(BuildContext context) {
    final viewport = MediaQuery.sizeOf(context).width;
    final gap = viewport >= _desktopWidth
        ? 20.0
        : viewport >= 640
        ? 14.0
        : 12.0;
    final rows = <Widget>[];
    for (var i = 0; i < shopCatalogue.length; i += 2) {
      final pair = shopCatalogue.skip(i).take(2).toList();
      rows.add(
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var j = 0; j < 2; j++) ...[
                if (j > 0) SizedBox(width: gap),
                Expanded(
                  child: j < pair.length
                      ? ShopCardWeb(
                          item: pair[j],
                          pricing: pricing,
                          onTap: pair[j].soldOut ? null : () => onOpen(pair[j]),
                        )
                      : const SizedBox(),
                ),
              ],
            ],
          ),
        ),
      );
      if (i + 2 < shopCatalogue.length) rows.add(SizedBox(height: gap));
    }
    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Column(children: rows),
    );
  }
}

/// `.pt-shop-card`: the photo with its badge, then name, three features and
/// the price pair. Sold out: grey badge, dimmed grey artwork, no tap. With a
/// mouse, a card for sale lifts 2px with a red border, as the web's does.
class ShopCardWeb extends StatefulWidget {
  const ShopCardWeb({
    super.key,
    required this.item,
    required this.pricing,
    this.onTap,
  });

  final CatalogueItem item;
  final Pricing? pricing;
  final VoidCallback? onTap;

  @override
  State<ShopCardWeb> createState() => _ShopCardWebState();
}

class _ShopCardWebState extends State<ShopCardWeb> {
  static const _grayscale = <double>[
    0.2126, 0.7152, 0.0722, 0, 0, //
    0.2126, 0.7152, 0.0722, 0, 0, //
    0.2126, 0.7152, 0.0722, 0, 0, //
    0, 0, 0, 1, 0, //
  ];

  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final viewport = MediaQuery.sizeOf(context).width;
    final desktop = viewport >= _desktopWidth;
    final nameSize = desktop
        ? 16.0
        : viewport >= 640
        ? 14.08
        : viewport >= 480
        ? 13.76
        : 13.12;
    final priceSize = viewport >= 480 ? 16.0 : 14.72;
    final priceLine = viewport >= 480 ? 21.0 : 20.0;
    final pad = viewport >= 640
        ? const EdgeInsets.fromLTRB(13, 11, 13, 14)
        : const EdgeInsets.fromLTRB(11, 10, 11, 13);
    final shown = cardPrice(item, widget.pricing);
    final out = item.soldOut;
    final lifted = _hover && !out && widget.onTap != null;
    Widget photo = Image.asset(
      desktop ? item.assetDesktop : item.asset,
      fit: BoxFit.cover,
    );
    if (out) {
      photo = Opacity(
        opacity: .55,
        child: ColorFiltered(
          colorFilter: const ColorFilter.matrix(_grayscale),
          child: photo,
        ),
      );
    }
    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        transform: Matrix4.translationValues(0, lifted ? -2 : 0, 0),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: out ? _C.outBg : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: lifted ? _C.red : _C.line),
          boxShadow: [
            lifted
                ? const BoxShadow(
                    color: Color(0x1A000000),
                    offset: Offset(0, 4),
                    blurRadius: 16,
                  )
                : const BoxShadow(
                    color: Color(0x0D000000),
                    offset: Offset(0, 1),
                    blurRadius: 4,
                  ),
          ],
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            onTap: widget.onTap,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AspectRatio(
                  aspectRatio: desktop ? 16 / 9 : 4 / 3,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      const ColoredBox(color: _C.imgBg),
                      photo,
                      Positioned(
                        top: 8,
                        left: 8,
                        child: _Badge(
                          out ? 'SOLD OUT' : '${shown.discount}% OFF',
                          out: out,
                        ),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: pad,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: wt(
                          nameSize,
                          weight: FontWeight.w700,
                          height: 1.35,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        item.features.take(3).join(' · '),
                        maxLines: 1,
                        softWrap: false,
                        overflow: TextOverflow.ellipsis,
                        style: wt(10.56, color: _C.grey, height: 1.35),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Text(
                            '₹${shown.price}',
                            style: wt(
                              priceSize,
                              weight: FontWeight.w900,
                              height: priceLine / priceSize,
                            ),
                          ),
                          const SizedBox(width: 5),
                          Text(
                            '₹${shown.orig}',
                            style: wt(
                              11.2,
                              color: _C.grey400,
                              height: 15 / 11.2,
                            ).copyWith(decoration: TextDecoration.lineThrough),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// `.pt-shop-badge`: "40% OFF" on red, or "SOLD OUT" on grey, spaced wider.
class _Badge extends StatelessWidget {
  const _Badge(this.text, {required this.out});

  final String text;
  final bool out;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: out ? _C.grey : _C.red,
        borderRadius: BorderRadius.circular(5),
      ),
      child: Text(
        text,
        style: wt(
          9.6,
          weight: FontWeight.w800,
          color: Colors.white,
          height: 12 / 9.6,
          spacing: out ? .96 : .288,
        ),
      ),
    );
  }
}

/// Opens the web's product sheet (welcome-shop.js renderSheet) for [item].
/// [onBuy] gets the sheet's own context and the chosen variant label; the
/// sheet is still open when it is called, so the caller closes it and goes
/// on to the address and pack steps.
Future<void> showProductSheet(
  BuildContext context, {
  required CatalogueItem item,
  required Pricing? pricing,
  String? initialVariant,
  required void Function(BuildContext sheet, String variant) onBuy,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    // Over the shell's bottom nav, as the web sheet is over its tab bar.
    useRootNavigator: true,
    useSafeArea: false,
    backgroundColor: Colors.white,
    constraints: BoxConstraints(
      maxWidth: 480,
      maxHeight: MediaQuery.sizeOf(context).height * .9,
    ),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (ctx) => ProductSheetWeb(
      item: item,
      pricing: pricing,
      initialVariant: initialVariant,
      onBuy: (v) => onBuy(ctx, v),
    ),
  );
}

/// `.pt-sheet` with the product body: photo, name and blurb, price pair with
/// the discount, Select Variant, Available Offers, BUY NOW.
class ProductSheetWeb extends StatefulWidget {
  const ProductSheetWeb({
    super.key,
    required this.item,
    required this.pricing,
    required this.onBuy,
    this.initialVariant,
  });

  final CatalogueItem item;
  final Pricing? pricing;
  final String? initialVariant;
  final ValueChanged<String> onBuy;

  @override
  State<ProductSheetWeb> createState() => _ProductSheetWebState();
}

class _ProductSheetWebState extends State<ProductSheetWeb> {
  late int _variant = () {
    final i = widget.item.variants.indexOf(widget.initialVariant ?? '');
    return i < 0 ? 0 : i;
  }();

  @override
  Widget build(BuildContext context) {
    final p = widget.item;
    final shown = cardPrice(p, widget.pricing);
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    final desktop = MediaQuery.sizeOf(context).width >= _desktopWidth;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 40,
          height: 4,
          margin: const EdgeInsets.only(top: 12),
          decoration: BoxDecoration(
            color: _C.line,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        Flexible(
          child: SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(
              20,
              16,
              20,
              24 + (bottomInset > 16 ? bottomInset : 16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: AspectRatio(
                    aspectRatio: 16 / 9,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        const ColoredBox(color: _C.imgBg),
                        Image.asset(
                          desktop ? p.assetDesktop : p.asset,
                          fit: BoxFit.cover,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  '${p.name}. ${p.desc}',
                  style: wt(16.8, weight: FontWeight.w900, height: 1.35),
                ),
                const SizedBox(height: 14),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      '₹${shown.price}',
                      style: wt(24, weight: FontWeight.w900, height: 32 / 24),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      '₹${shown.orig}',
                      style: wt(
                        14.08,
                        color: _C.grey400,
                        height: 19 / 14.08,
                      ).copyWith(decoration: TextDecoration.lineThrough),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      shown.code != null
                          ? '${shown.code} applied'
                          : '${shown.discount}% off',
                      style: wt(
                        13.12,
                        weight: FontWeight.w700,
                        color: _C.red,
                        height: 17 / 13.12,
                      ),
                    ),
                  ],
                ),
                // The row's 4px and the label's 16px margins collapse to 16.
                const SizedBox(height: 16),
                Text(
                  'Select Variant',
                  style: wt(
                    14.08,
                    weight: FontWeight.w700,
                    color: _C.slate,
                    height: 19 / 14.08,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (var i = 0; i < p.variants.length; i++)
                      _VariantChip(
                        p.variants[i],
                        active: i == _variant,
                        onTap: () => setState(() => _variant = i),
                      ),
                  ],
                ),
                const SizedBox(height: 18),
                Row(
                  children: [
                    const CustomPaint(size: Size(16, 16), painter: _TagGlyph()),
                    const SizedBox(width: 7),
                    Text(
                      'Available Offers',
                      style: wt(
                        14.08,
                        weight: FontWeight.w700,
                        color: _C.slate,
                        height: 19 / 14.08,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                for (final f in p.features)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      children: [
                        Container(
                          width: 7,
                          height: 7,
                          decoration: const BoxDecoration(
                            color: _C.red,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            f,
                            style: wt(
                              13.28,
                              color: _C.slate,
                              height: 17 / 13.28,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 22),
                Material(
                  color: _C.red,
                  borderRadius: BorderRadius.circular(16),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(16),
                    highlightColor: _C.redDark,
                    onTap: () => widget.onBuy(p.variants[_variant]),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        'BUY NOW',
                        textAlign: TextAlign.center,
                        style: wt(
                          16,
                          weight: FontWeight.w800,
                          color: Colors.white,
                          height: 21 / 16,
                          spacing: .48,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  'Secured by Razorpay  |  UPI, Cards, Net Banking',
                  textAlign: TextAlign.center,
                  style: wt(
                    12,
                    weight: FontWeight.w600,
                    color: _C.grey400,
                    height: 16 / 12,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// `.pt-sheet-var`: a 31px pill, red when chosen. The 1px border is inside
/// the box, as a border-box button's is.
class _VariantChip extends StatelessWidget {
  const _VariantChip(this.label, {required this.active, required this.onTap});

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: active ? _C.red : Colors.white,
        border: Border.all(color: active ? _C.red : _C.line),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
            child: Text(
              label,
              style: wt(
                13.28,
                weight: FontWeight.w600,
                color: active ? Colors.white : _C.slate,
                height: 15 / 13.28,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The 16px tag outline before "Available Offers" (the sheet's inline SVG,
/// viewBox 24, stroke 2, with the filled eyelet).
class _TagGlyph extends CustomPainter {
  const _TagGlyph();

  @override
  void paint(Canvas canvas, Size size) {
    final k = size.width / 24;
    final stroke = Paint()
      ..color = _C.red
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2 * k
      ..strokeJoin = StrokeJoin.round
      ..strokeCap = StrokeCap.round;
    final path = Path()
      ..moveTo(20.59 * k, 13.41 * k)
      ..lineTo(13.42 * k, 20.58 * k)
      ..arcToPoint(Offset(10.59 * k, 20.58 * k), radius: Radius.circular(2 * k))
      ..lineTo(2 * k, 12 * k)
      ..lineTo(2 * k, 2 * k)
      ..lineTo(12 * k, 2 * k)
      ..lineTo(20.59 * k, 10.59 * k)
      ..arcToPoint(Offset(20.59 * k, 13.41 * k), radius: Radius.circular(2 * k))
      ..close();
    canvas.drawPath(path, stroke);
    canvas.drawCircle(Offset(7 * k, 7 * k), 1.5 * k, Paint()..color = _C.red);
  }

  @override
  bool shouldRepaint(_TagGlyph oldDelegate) => false;
}
