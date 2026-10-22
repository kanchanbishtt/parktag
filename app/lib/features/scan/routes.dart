import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import '../../core/web_bridge.dart';
import 'scanner_screen.dart';
import 'tag_screen.dart';

final _token = RegExp(r'^[A-Za-z0-9]{12,64}$');

/// `/scan`: the Scan tab.
final scanBranchRoutes = <RouteBase>[
  GoRoute(path: '/scan', builder: (context, state) => const ScannerScreen()),
];

/// `/t/:token` (lookup, verify, contact, activation) and the activation
/// bridge, on the root navigator.
final scanRootRoutes = <RouteBase>[
  GoRoute(
    path: '/t/:token',
    parentNavigatorKey: rootKey,
    redirect: (_, s) =>
        _token.hasMatch(s.pathParameters['token'] ?? '') ? null : '/scan',
    builder: (context, state) =>
        TagScreen(token: state.pathParameters['token']!),
    routes: [
      // Web activation: SMS fallback or a send-otp captcha rejection. The
      // scanner page stays put after activating, so the bridge also checks
      // the session on every load and on close.
      GoRoute(
        path: 'web',
        parentNavigatorKey: rootKey,
        builder: (context, state) => WebBridgeScreen(
          url: 'https://$bridgeHost/tag/${state.pathParameters['token']}',
          title: 'Activate',
        ),
      ),
    ],
  ),
];
