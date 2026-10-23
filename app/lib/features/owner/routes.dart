import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import 'activity_screen.dart';
import '../onboarding/hub_screen.dart';
import 'tag_detail_screen.dart';
import 'tags_screen.dart';

/// `/home`: the signed-in Home tab: the same action hub guests get on
/// `/hub`, with the Sign in tile swapped for the owner's tags.
final homeBranchRoutes = <RouteBase>[
  GoRoute(path: '/home', builder: (context, state) => const HubScreen()),
];

/// `/tags`: the Tags tab, the web owner dashboard (the tag icon on its nav).
final tagsBranchRoutes = <RouteBase>[
  GoRoute(path: '/tags', builder: (context, state) => const TagsScreen()),
];

/// `/tags/:tagId` and `/activity`, on the root navigator.
final ownerRootRoutes = <RouteBase>[
  GoRoute(
    path: '/tags/:tagId',
    parentNavigatorKey: rootKey,
    builder: (context, state) => TagDetailScreen(
      tagId: state.pathParameters['tagId']!,
      open: state.uri.queryParameters['open'],
    ),
  ),
  GoRoute(
    path: '/activity',
    parentNavigatorKey: rootKey,
    builder: (context, state) => ActivityScreen(
      tagId: state.uri.queryParameters['tag'],
      requestId: state.uri.queryParameters['request'],
    ),
  ),
];
