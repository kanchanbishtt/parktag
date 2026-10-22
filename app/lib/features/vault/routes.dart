import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import '../../core/platform.dart';
import 'vault_screen.dart';

/// `/tags/:tagId/vault` on the root navigator, behind FLAG_SECURE.
final vaultRootRoutes = <RouteBase>[
  GoRoute(
    path: '/tags/:tagId/vault',
    parentNavigatorKey: rootKey,
    builder: (context, state) =>
        SecureScreen(child: VaultScreen(tagId: state.pathParameters['tagId']!)),
  ),
];
