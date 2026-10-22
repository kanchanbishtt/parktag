import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import 'address_screen.dart';
import 'confirm_screen.dart';
import 'models.dart';
import 'orders_screen.dart';
import 'shop_screen.dart';
import 'track_order_screen.dart';

/// `/shop`: the signed-in Shop tab. Guests get a Custom Tab from the shell.
final shopBranchRoutes = <RouteBase>[
  GoRoute(
    path: '/shop',
    builder: (context, state) {
      final q = state.uri.queryParameters;
      final variant = q['variant'];
      return ShopScreen(
        // Keyed so a new replace link rebuilds rather than reusing old state.
        key: ValueKey(state.uri.query),
        replaceTagId: parseReplaceTagId(q['replaceTagId']),
        variant: shopVariants.contains(variant) ? variant : null,
      );
    },
  ),
];

/// `/shop/address`, `/shop/confirmed`, `/shop/orders*` on the root navigator,
/// plus `/track-order`, which is public: buyers who are not signed in look an
/// order up by number and the delivery phone's last 4 digits.
final shopRootRoutes = <RouteBase>[
  GoRoute(
    parentNavigatorKey: rootKey,
    path: '/track-order',
    builder: (context, state) =>
        TrackOrderScreen(initialOrderNumber: state.uri.queryParameters['order']),
  ),
  GoRoute(
    parentNavigatorKey: rootKey,
    path: '/shop/address',
    builder: (context, state) =>
        AddressScreen(initial: state.extra is Address ? state.extra as Address : null),
  ),
  GoRoute(
    parentNavigatorKey: rootKey,
    path: '/shop/confirmed',
    // Only reachable straight after checkout; a cold link shows the orders.
    redirect: (_, state) => state.extra is OrderConfirmation ? null : '/shop/orders',
    builder: (context, state) =>
        ConfirmScreen(order: state.extra! as OrderConfirmation),
  ),
  GoRoute(
    parentNavigatorKey: rootKey,
    path: '/shop/orders',
    builder: (context, state) => const OrdersScreen(),
    routes: [
      GoRoute(
        parentNavigatorKey: rootKey,
        path: ':id',
        builder: (context, state) =>
            TrackScreen(orderId: state.pathParameters['id']!),
      ),
    ],
  ),
];
