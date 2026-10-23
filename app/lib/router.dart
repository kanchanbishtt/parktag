import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'core/app_state.dart';
import 'core/qr_parse.dart';
import 'core/widgets.dart';
import 'features/auth/routes.dart';
import 'features/more/routes.dart';
import 'features/onboarding/routes.dart';
import 'features/owner/routes.dart';
import 'features/scan/routes.dart';
import 'features/shop/routes.dart';
import 'features/vault/routes.dart';

const _ownerOnly = [
  '/home',
  '/tags',
  '/more',
  // The shop itself is open to guests; buying and orders are not.
  '/shop/address',
  '/shop/confirmed',
  '/shop/orders',
  '/activity',
  '/add-vehicles',
];
const _guestOnly = ['/hub', '/login', '/onboarding'];
final _tagId = RegExp(r'^[A-Za-z0-9]{1,64}$');

/// Guest vs owner guard. Guests: Home is `/hub`, owner areas go to `/login`.
/// Owners skip the guest screens.
String? guardRedirect(Uri uri, {required bool isOwner}) {
  final path = uri.path;
  if (isOwner) return _guestOnly.contains(path) ? '/home' : null;
  if (path == '/home') return '/hub';
  final ownerArea = _ownerOnly.any((r) => path == r || path.startsWith('$r/'));
  return ownerArea ? '/login' : null;
}

/// App Links `/tag/<token>`, `/vehicle/<token>` (and `?token=`) go to `/t/<token>`
/// after the strict parse; anything malformed lands on the scanner.
/// The router may hand over the full https URL or just the path, so only the
/// path and query are kept and re-anchored on the tag host.
String tagLinkRedirect(Uri uri) {
  final query = uri.hasQuery ? '?${uri.query}' : '';
  final token = parseTagUrl('https://$tagHost${uri.path}$query');
  return token == null ? '/scan' : '/t/$token';
}

/// Sections the web vehicle page auto-opens (vehicle-detail.js autoOpenSection).
const tagOpenKeys = {'etag', 'premium', 'replacement'};

/// `/v/<tagId>[?open=etag|premium|replacement]` goes to the owner's tag
/// screen, behind the guard. A known `open` is passed through as a query param.
String tagIdLinkRedirect(String? tagId, [String? open]) {
  if (tagId == null || !_tagId.hasMatch(tagId)) return '/home';
  return tagOpenKeys.contains(open)
      ? '/tags/$tagId?open=$open'
      : '/tags/$tagId';
}

GoRouter buildRouter(AppState app) {
  String linkRedirect(BuildContext _, GoRouterState s) =>
      tagLinkRedirect(s.uri);
  return GoRouter(
    navigatorKey: rootKey,
    initialLocation: '/splash',
    refreshListenable: app,
    redirect: (context, state) =>
        guardRedirect(state.uri, isOwner: app.isOwner),
    errorBuilder: (context, state) => const NotFoundScreen(),
    routes: [
      for (final p in ['/tag', '/tag/:token', '/vehicle', '/vehicle/:token'])
        GoRoute(path: p, redirect: linkRedirect),
      GoRoute(
        path: '/v/:tagId',
        redirect: (_, s) => tagIdLinkRedirect(
          s.pathParameters['tagId'],
          s.uri.queryParameters['open'],
        ),
      ),
      // `/get?ref=CODE` (the referral link): park the code, then the shop.
      // Guests are sent on to sign-in by the guard; the code waits for them.
      GoRoute(
        path: '/get',
        redirect: (_, s) {
          app.setPendingReferralCode(s.uri.queryParameters['ref']);
          return '/shop';
        },
      ),
      ...onboardingRootRoutes,
      ...authRootRoutes,
      ...scanRootRoutes,
      ...vaultRootRoutes,
      ...ownerRootRoutes,
      ...shopRootRoutes,
      ...moreRootRoutes,
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [...homeBranchRoutes, ...homeGuestRoutes],
          ),
          StatefulShellBranch(routes: scanBranchRoutes),
          StatefulShellBranch(routes: shopBranchRoutes),
          StatefulShellBranch(routes: tagsBranchRoutes),
          StatefulShellBranch(routes: moreBranchRoutes),
        ],
      ),
    ],
  );
}

const _tabs = [
  PtNavItem('Home', Icons.home_rounded),
  PtNavItem('Scan', Icons.qr_code_scanner_rounded),
  PtNavItem('Shop', Icons.shopping_bag_rounded),
  PtNavItem('Tags', Icons.local_offer_rounded),
  PtNavItem('More', Icons.menu_rounded),
];

class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  void _onTap(BuildContext context, int index) {
    shell.goBranch(index, initialLocation: index == shell.currentIndex);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      body: shell,
      bottomNavigationBar: PtNavBar(
        items: _tabs,
        index: shell.currentIndex,
        onTap: (i) => _onTap(context, i),
      ),
    );
  }
}

/// Unknown route, e.g. a stale or mistyped link.
class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: Center(
        child: EmptyState(
          icon: Icons.link_off_rounded,
          title: 'Page not found',
          body: 'This link does not lead anywhere in ParkTag.',
          action: FilledButton(
            onPressed: () => context.go('/home'),
            child: const Text('Back to Home'),
          ),
        ),
      ),
    );
  }
}
