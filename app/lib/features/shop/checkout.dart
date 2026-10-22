import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'cart_store.dart';
import 'checkout_parts.dart';

export 'checkout_parts.dart'
    show addressWarning, promoRefusedText, referralRefusedText, replaceNote;
import 'models.dart';
import 'pay.dart';

const _maxQuantity = 20; // MAX_ORDER_QUANTITY on the server.
/// Pack sheet: quantity, codes, address, then pay online or Cash on Delivery.
class CheckoutSheet extends StatefulWidget {
  const CheckoutSheet({
    super.key,
    required this.product,
    required this.pricing,
    required this.onAddress,
    required this.onDone,
    this.initialQuantity = 1,
    this.initialVariant,
    this.replaceTagId,
  });

  final Product product;
  final Pricing pricing;
  final int initialQuantity;
  final String? initialVariant;

  /// The expired free-trial tag this purchase replaces (web goToShopForReplace).
  final String? replaceTagId;

  /// Opens the address form; returns the saved address.
  final Future<Address?> Function(Address? current) onAddress;
  final void Function(OrderConfirmation) onDone;

  @override
  State<CheckoutSheet> createState() => _CheckoutSheetState();
}

class _CheckoutSheetState extends State<CheckoutSheet> {
  final _promo = TextEditingController();
  final _ref = TextEditingController();
  final _otp = TextEditingController();

  late int _qty = widget.initialQuantity.clamp(1, _maxQuantity);
  late final List<String> _variants = variantsFor(_p.id);
  late String _variant = _variants.contains(widget.initialVariant)
      ? widget.initialVariant!
      : _variants.first;
  String? _addrWarning; // address-check said the address does not hang together
  bool _addressLoaded = false;
  Address? _address;
  String? _promoCode;
  int? _promoPayable;
  String? _promoNote;
  String? _refCode;
  int _refDiscount = 0;
  String? _refNote;
  String? _phoneHint; // set once the COD code is sent
  bool _busy = false;
  bool _paid = false; // charged but verify failed; never offer pay again
  String? _error;

  // Read once while mounted: the order may finish after the sheet is gone,
  // when looking AppScope up from this context would throw.
  late final AppState _app = AppScope.read(context);
  ApiClient get _api => _app.api;
  Product get _p => widget.product;

  @override
  void initState() {
    super.initState();
    _loadAddress();
    _keep();
    // A friend's link parked before sign-in (/get?ref=): checked like a typed one.
    final parked = _app.pendingReferralCode;
    if (parked != null) {
      _ref.text = parked;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _checkRef();
      });
    }
  }

  void _keep() => writeCart(SavedCart(_p.id,
      quantity: _qty, variant: _variant, replaceTagId: widget.replaceTagId));

  /// What every order route needs besides price inputs: the label to record
  /// and the trial tag to swap out. Same fields welcome-shop.js sends.
  Map<String, Object?> get _orderFields => {
        'productId': _p.id,
        'quantity': _qty,
        'variant': _variant,
        'replaceTagId': widget.replaceTagId,
        'promo': ?_promoCode,
      };

  Future<void> _ordered(OrderConfirmation c) async {
    try {
      await clearCart();
      await _app.clearPendingReferralCode(); // used: cleared as /get clears it
    } finally {
      widget.onDone(c); // paid or placed: always show the confirmation
    }
  }

  @override
  void dispose() {
    _promo.dispose();
    _ref.dispose();
    _otp.dispose();
    super.dispose();
  }

  Future<void> _loadAddress() async {
    try {
      final res = await _api.get('/api/owner/address');
      final a = res['address'];
      if (!mounted) return;
      setState(() {
        _address = a is Map<String, dynamic> ? Address.fromJson(a) : null;
        _addressLoaded = true;
      });
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  int get _subtotal => _promoPayable ?? _p.payableFor(_qty);
  int get _onlineTotal =>
      _refDiscount > 0 ? (_subtotal - _refDiscount).clamp(100, _subtotal) : _subtotal;
  int get _codTotal => _subtotal + widget.pricing.codSurchargePaise;

  void _setQty(int q) => setState(() {
        _qty = q;
        // A promo price was quoted for the old count.
        _promoCode = null;
        _promoPayable = null;
        _promoNote = null;
        _phoneHint = null;
        _keep();
      });

  void _setVariant(String v) => setState(() {
        _variant = v;
        _keep();
      });

  Future<void> _run(Future<void> Function() body) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await body();
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } on PayCancelled catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // Display only: the order routes resolve the code again.
  Future<void> _checkPromo() => _run(() async {
        final code = _promo.text.trim();
        if (code.isEmpty) return;
        final res = await _api.post('/api/shop/promo/check', {
          'code': code,
          'productId': _p.id,
          'quantity': _qty,
          'context': 'dashboard',
        });
        final ok = res['ok'] == true;
        final payable = res['payablePaise'];
        setState(() {
          _promoCode = ok ? (res['code'] as String? ?? code) : null;
          _promoPayable = ok && payable is num ? payable.toInt() : null;
          _promoNote = ok ? 'Code applied.' : 'That code does not work on this pack.';
        });
      });

  Future<void> _checkRef() => _run(() async {
        final code = _ref.text.trim();
        if (code.isEmpty) return;
        final res = await _api.post('/api/shop/referral/check', {'code': code});
        final ok = res['ok'] == true;
        final d = res['discountPaise'];
        setState(() {
          _refCode = ok ? code : null;
          _refDiscount = ok && d is num ? d.toInt() : 0;
          _refNote = ok
              ? 'Referral applied: ${formatRupees(_refDiscount)} off when you pay online.'
              : 'That referral code is not valid.';
        });
      });

  bool _needAddress() {
    if (_address != null) return false;
    setState(() => _error = 'Add a delivery address first.');
    return true;
  }

  Future<void> _payOnline() => _run(() async {
        if (_needAddress()) return;
        final key = (await _api.get('/api/shop/razorpay-key'))['keyId'];
        final order = await _api.post('/api/shop/create-order', {
          ..._orderFields,
          'ref': ?_refCode,
        });
        if (!mounted) return;
        // Stop before Razorpay opens at a price the sheet did not show.
        if (order['referralRefused'] != null) {
          setState(() {
            _refCode = null;
            _refDiscount = 0;
            _refNote = null;
            _error = referralRefusedText;
          });
          return;
        }
        if (_promoCode != null && order['promoRefused'] != null) {
          setState(() {
            _promoCode = null;
            _promoPayable = null;
            _promoNote = null;
            _error = promoRefusedText;
          });
          return;
        }
        // From here a kill must not reopen a sheet that offers paying again.
        await clearCart();
        final amount = order['amount'];
        final prefill = order['prefill'];
        final paid = await openRazorpay(
          key: key is String ? key : '',
          orderId: order['orderId'] as String? ?? '',
          amountPaise: amount is num ? amount.toInt() : 0,
          currency: order['currency'] as String? ?? 'INR',
          prefill: prefill is Map<String, dynamic> ? prefill : const {},
          description: _p.name,
        );
        try {
          await _api.post('/api/shop/verify-payment', paid.toJson());
        } on ApiError {
          if (mounted) {
            setState(() {
              _paid = true;
              _error = paidPendingText;
            });
          }
          return;
        }
        // Still called when the sheet was dismissed: the screen pushes the
        // confirmation either way.
        await _ordered(OrderConfirmation(order['orderNumber'] as String? ?? ''));
      });

  Future<void> _sendCodOtp() => _run(() async {
        if (_needAddress()) return;
        final address = _address!;
        final res = await _api.post('/api/shop/cod-otp/send');
        if (!mounted) return;
        setState(() => _phoneHint = res['phoneHint'] as String? ?? '');
        _checkAddress(address);
      });

  /// A parcel the courier cannot find comes back at ParkTag's cost, so warn
  /// once on the code screen. Unknown or failed lookups never stop the order.
  Future<void> _checkAddress(Address a) async {
    try {
      final res = await _api.post('/api/shop/address-check', {'address': a.toJson()});
      if (mounted && res['validated'] == false && _address == a) {
        setState(() => _addrWarning = addressWarning(a.pincode));
      }
    } on ApiError {
      // Carry on without the warning.
    }
  }

  Future<void> _placeCod() => _run(() async {
        final otp = _otp.text.trim();
        if (otp.length != OtpField.length) {
          setState(() => _error = 'Enter the 6-digit code.');
          return;
        }
        final res = await _api.post('/api/shop/place-cod', {
          ..._orderFields,
          'otp': otp,
        });
        if (res['needsOtp'] == true && mounted) {
          setState(() => _error = 'Enter the code we sent.');
          return;
        }
        final secs = res['flashOfferSeconds'];
        await _ordered(OrderConfirmation(
          res['orderNumber'] as String? ?? '',
          cod: true,
          flashSeconds: secs is num ? secs.toInt() : 0,
          flashDiscountPaise: widget.pricing.flashDiscountPaise,
        ));
      });

  Future<void> _editAddress() async {
    final saved = await widget.onAddress(_address);
    if (saved != null && mounted) {
      setState(() {
        _address = saved;
        _addrWarning = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // No back or barrier dismiss mid-request, so the result lands here.
    return PopScope(canPop: !_busy, child: _body());
  }

  Widget _body() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(_p.name,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        if (widget.replaceTagId != null) ...[
          const SizedBox(height: 4),
          const Text(replaceNote, style: TextStyle(color: PtColors.muted)),
        ],
        const SizedBox(height: 12),
        VariantPicker(
          variants: _variants,
          selected: _variant,
          onSelected: _busy ? null : _setVariant,
        ),
        Row(
          children: [
            const Text('Quantity'),
            const Spacer(),
            IconButton(
              tooltip: 'Fewer',
              onPressed: _busy || _qty <= 1 ? null : () => _setQty(_qty - 1),
              icon: const Icon(Icons.remove_circle_outline),
            ),
            Text('$_qty', style: const TextStyle(fontWeight: FontWeight.w700)),
            IconButton(
              tooltip: 'More',
              onPressed:
                  _busy || _qty >= _maxQuantity ? null : () => _setQty(_qty + 1),
              icon: const Icon(Icons.add_circle_outline),
            ),
          ],
        ),
        CodeRow(
            controller: _promo,
            label: 'Promo code',
            onApply: _busy ? null : _checkPromo,
            note: _promoNote),
        const SizedBox(height: 8),
        CodeRow(
            controller: _ref,
            label: 'Referral code',
            onApply: _busy ? null : _checkRef,
            note: _refNote),
        const SizedBox(height: 12),
        AddressCard(
            address: _address,
            loaded: _addressLoaded,
            onTap: _busy || !_addressLoaded ? null : _editAddress),
        const SizedBox(height: 12),
        Text('Pay online: ${formatRupees(_onlineTotal)}',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
        Text(
            'Cash on Delivery: ${formatRupees(_codTotal)} '
            '(includes ${formatRupees(widget.pricing.codSurchargePaise)} COD fee)',
            style: const TextStyle(color: PtColors.muted)),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: PtColors.error)),
        ],
        const SizedBox(height: 16),
        if (_phoneHint == null) ...[
          FilledButton(
            onPressed: _busy || _paid || !_addressLoaded ? null : _payOnline,
            child: const Text('Pay online'),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: _busy || _paid || !_addressLoaded ? null : _sendCodOtp,
            child: const Text('Cash on Delivery'),
          ),
        ] else ...[
          Text('We sent a code on WhatsApp to $_phoneHint. '
              'Enter it to confirm your Cash on Delivery order.'),
          if (_addrWarning != null) ...[
            const SizedBox(height: 8),
            Text(_addrWarning!, style: const TextStyle(color: PtColors.error)),
          ],
          const SizedBox(height: 8),
          OtpField(controller: _otp),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _busy ? null : _placeCod,
            child: const Text('Place order'),
          ),
          TextButton(
            onPressed: _busy ? null : () => setState(() => _phoneHint = null),
            child: const Text('Back'),
          ),
        ],
      ],
    );
  }
}
