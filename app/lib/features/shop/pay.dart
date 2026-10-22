import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

/// Razorpay's signed answer, posted back to the matching verify route.
class PayResult {
  const PayResult(this.orderId, this.paymentId, this.signature);

  final String orderId, paymentId, signature;

  Map<String, String> toJson() => {
        'razorpay_order_id': orderId,
        'razorpay_payment_id': paymentId,
        'razorpay_signature': signature,
      };
}

/// The sheet was closed or the payment failed. Nothing to verify.
class PayCancelled implements Exception {
  const PayCancelled(this.message);

  final String message;
}

/// Razorpay took the money but our verify call failed. The webhook settles
/// the order, so the buyer must not pay again.
const paidPendingText = 'Payment received. We are confirming your order, '
    'check My orders in a minute. Do not pay again.';

typedef PayLauncher = Future<PayResult> Function(Map<String, dynamic> options);

/// Opens Razorpay Checkout. Tests swap this for a fake. Only `/api/shop/*`
/// orders (physical stickers) ever reach it.
@visibleForTesting
PayLauncher payLauncher = _razorpay;

Future<PayResult> openRazorpay({
  required String key,
  required String orderId,
  required int amountPaise,
  String currency = 'INR',
  Map<String, dynamic> prefill = const {},
  String description = 'ParkTag order',
}) =>
    payLauncher({
      'key': key,
      'order_id': orderId,
      'amount': amountPaise,
      'currency': currency,
      'name': 'ParkTag',
      'description': description,
      'prefill': prefill,
    });

Future<PayResult> _razorpay(Map<String, dynamic> options) {
  final rz = Razorpay();
  final done = Completer<PayResult>();
  rz.on(Razorpay.EVENT_PAYMENT_SUCCESS, (PaymentSuccessResponse r) {
    if (done.isCompleted) return;
    done.complete(PayResult(r.orderId ?? '', r.paymentId ?? '', r.signature ?? ''));
  });
  rz.on(Razorpay.EVENT_PAYMENT_ERROR, (PaymentFailureResponse r) {
    if (done.isCompleted) return;
    done.completeError(PayCancelled(r.code == Razorpay.PAYMENT_CANCELLED
        ? 'Payment cancelled.'
        : 'Payment did not go through. Try again.'));
  });
  rz.on(Razorpay.EVENT_EXTERNAL_WALLET, (ExternalWalletResponse _) {
    if (done.isCompleted) return;
    done.completeError(const PayCancelled('Pay with UPI or a card instead.'));
  });
  rz.open(options);
  return done.future.whenComplete(rz.clear);
}
