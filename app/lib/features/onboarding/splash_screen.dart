import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Where a cold start goes: an owner to `/home`, a first launch to
/// `/onboarding`, everyone else to `/hub`. Throws [ApiError] when a stored
/// cookie could not be checked (offline).
Future<String> splashTarget(AppState app) async {
  // main() already tried; this retries a check that failed offline.
  if (!app.isOwner) {
    if (await app.api.hasCookie()) {
      await app.loadSession();
    } else if (kIsWeb) {
      // The browser may still hold the cookie; a failed check is not fatal.
      try {
        await app.loadSession();
      } on ApiError {
        // Treated as signed out for this run.
      }
    }
  }
  if (app.isOwner) return '/home';
  return await app.api.store.isOnboarded() ? '/hub' : '/onboarding';
}

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _route());
  }

  Future<void> _route() async {
    setState(() => _error = null);
    try {
      final target = await splashTarget(AppScope.read(context));
      if (mounted) context.go(target);
    } on ApiError catch (e) {
      if (mounted) {
        setState(() => _error = e.isNetwork ? offlineError : e.message);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: PtColors.navy,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const PtLogo(height: 56, onDark: true),
                const SizedBox(height: 24),
                if (_error == null)
                  const CircularProgressIndicator(color: PtColors.accent)
                else
                  ErrorCard(message: _error!, onRetry: _route),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
