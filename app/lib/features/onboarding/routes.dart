import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import 'help_screen.dart';
import 'hub_screen.dart';
import 'onboarding_screen.dart';
import 'splash_screen.dart';

/// `/splash`, `/onboarding`, `/help` on the root navigator.
final onboardingRootRoutes = <RouteBase>[
  GoRoute(
    path: '/splash',
    parentNavigatorKey: rootKey,
    builder: (context, state) => const SplashScreen(),
  ),
  GoRoute(
    path: '/onboarding',
    parentNavigatorKey: rootKey,
    builder: (context, state) => const OnboardingScreen(),
  ),
  GoRoute(
    path: '/help',
    parentNavigatorKey: rootKey,
    builder: (context, state) => const HelpScreen(),
  ),
];

/// `/hub`: the guest Home tab.
final homeGuestRoutes = <RouteBase>[
  GoRoute(
    path: '/hub',
    builder: (context, state) => const HubScreen(),
  ),
];
