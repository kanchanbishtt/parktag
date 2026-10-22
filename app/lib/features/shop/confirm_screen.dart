import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/theme.dart';
import 'models.dart';
import 'pay.dart';

/// Order placed. COD orders get the "pay now, skip the COD fee" offer while
/// its server-set window lasts.
class ConfirmScreen extends StatefulWidget {
  const ConfirmScreen({super.key, required this.order});

  final OrderConfirmation order;

  @override
  State<ConfirmScreen> createState() => _ConfirmScreenState();
}

class _ConfirmScreenState extends State<ConfirmScreen> {
  late int _left = widget.order.cod ? widget.order.flashSeconds : 0;
  Timer? _timer;
  bool _busy = false;
  bool _prepaid = false;
  bool _paidPending = false; // charged but verify failed
  String? _error;

  @override
  void initState() {
    super.initState();
    if (_left > 0) {
      _timer = Timer.periodic(const Duration(seconds: 1), (t) {
        setState(() => _left--);
        if (_left <= 0) t.cancel();
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _prepay() async {
    final api = AppScope.read(context).api;
    final number = widget.order.orderNumber;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final o = await api.post('/api/shop/cod-prepay-order', {'orderNumber': number});
      final amount = o['amount'];
      final prefill = o['prefill'];
      final paid = await openRazorpay(
        key: o['keyId'] as String? ?? '',
        orderId: o['orderId'] as String? ?? '',
        amountPaise: amount is num ? amount.toInt() : 0,
        currency: o['currency'] as String? ?? 'INR',
        prefill: prefill is Map<String, dynamic> ? prefill : const {},
      );
      _timer?.cancel();
      try {
        await api.post('/api/shop/cod-prepay-verify', {'orderNumber': number, ...paid.toJson()});
      } on ApiError {
        if (mounted) {
          setState(() {
            _paidPending = true;
            _error = paidPendingText;
          });
        }
        return;
      }
      if (mounted) setState(() => _prepaid = true);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } on PayCancelled catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.order;
    final cod = o.cod && !_prepaid;
    return Scaffold(
      appBar: AppBar(title: const Text('Order placed')),
      body: ListView(
        padding: const EdgeInsets.all(PtLayout.padX),
        children: [
          const Icon(Icons.check_circle_rounded, color: PtColors.success, size: 56),
          const SizedBox(height: 12),
          Text(cod ? 'Order confirmed. Pay when it arrives.' : 'Payment received.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          if (o.orderNumber.isNotEmpty)
            Text('Order ${o.orderNumber}',
                textAlign: TextAlign.center,
                style: const TextStyle(color: PtColors.muted)),
          if (cod && _left > 0 && !_paidPending) ...[
            const SizedBox(height: 16),
            _flashOffer(o),
          ],
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: PtColors.error)),
          ],
          const SizedBox(height: 24),
          const Text('How to activate',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          for (final (i, step) in const [
            'When your tag arrives, stick it on the inside of your windscreen.',
            'Open the Scan tab and point the camera at the tag.',
            'Follow the steps to link the tag to your vehicle.',
          ].indexed)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(
                  radius: 14,
                  backgroundColor: PtColors.amberBg,
                  child: Text('${i + 1}',
                      style: const TextStyle(color: PtColors.amberDeep))),
              title: Text(step),
            ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: () => context.go('/scan'),
            icon: const Icon(Icons.qr_code_scanner_rounded),
            label: const Text('Open Scan'),
          ),
          TextButton(
            onPressed: () => context.go('/shop/orders'),
            child: const Text('View my orders'),
          ),
        ],
      ),
    );
  }

  Widget _flashOffer(OrderConfirmation o) {
    return Card(
      color: PtColors.amberBg,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
                o.flashDiscountPaise > 0
                    ? 'Pay online now and save ${formatRupees(o.flashDiscountPaise)}'
                    : 'Pay online now instead',
                style: const TextStyle(fontWeight: FontWeight.w800)),
            Text('Offer ends in ${_left}s',
                style: const TextStyle(color: PtColors.amberDeep)),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _busy ? null : _prepay,
              child: const Text('Pay now'),
            ),
          ],
        ),
      ),
    );
  }
}
