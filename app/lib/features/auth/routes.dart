import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import '../../core/web_bridge.dart';
import 'add_vehicles_screen.dart';
import 'auth_flow.dart';
import 'login_screen.dart';

/// `/login`, `/login/web` and `/add-vehicles` on the root navigator.
final authRootRoutes = <RouteBase>[
  // Signed-in owners only; the shared guard does not list this path.
  GoRoute(
    path: addVehiclesPath,
    parentNavigatorKey: rootKey,
    redirect: (context, _) => AppScope.read(context).isOwner ? null : '/login',
    builder: (context, state) => const AddVehiclesScreen(),
  ),
  GoRoute(
    path: '/login',
    parentNavigatorKey: rootKey,
    builder: (context, state) => const LoginScreen(),
  ),
  // Captcha fallback, SMS fallback and Play Integrity failures. Finishes only
  // once /api/session confirms an owner, then goes to /home.
  GoRoute(
    path: '/login/web',
    parentNavigatorKey: rootKey,
    builder: (context, state) => const WebBridgeScreen(url: bridgeLoginUrl),
  ),
];
