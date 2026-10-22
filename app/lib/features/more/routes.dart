import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import 'delete_account_screen.dart';
import 'membership_screen.dart';
import 'more_screen.dart';
import 'pin_screen.dart';
import 'profile_screen.dart';

/// `/more`: the More tab.
final moreBranchRoutes = <RouteBase>[
  GoRoute(path: '/more', builder: (context, state) => const MoreScreen()),
];

/// `/more/*` detail screens on the root navigator.
final moreRootRoutes = <RouteBase>[
  GoRoute(
    path: '/more/profile',
    parentNavigatorKey: rootKey,
    builder: (context, state) => const ProfileScreen(),
  ),
  GoRoute(
    path: '/more/pin',
    parentNavigatorKey: rootKey,
    builder: (context, state) => const PinScreen(),
  ),
  GoRoute(
    path: '/more/membership',
    parentNavigatorKey: rootKey,
    builder: (context, state) => const MembershipScreen(),
  ),
  GoRoute(
    path: '/more/delete-account',
    parentNavigatorKey: rootKey,
    builder: (context, state) => const DeleteAccountScreen(),
  ),
];
