import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'core/api.dart';
import 'core/app_state.dart';
import 'core/session.dart';
import 'core/theme.dart';
import 'push/push.dart';
import 'router.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await _initFirebase();
  final app = AppState(ApiClient(store: SessionStore()));
  await app.bootstrap();
  await Push.init(app);
  runApp(ParkTagApp(app: app));
}

// Android reads google-services.json. Web skips Firebase for now (spec 12).
Future<void> _initFirebase() async {
  if (kIsWeb) return;
  try {
    await Firebase.initializeApp();
    await _initCrashlytics();
    await FirebaseAppCheck.instance.activate(
      providerAndroid: kReleaseMode
          ? const AndroidPlayIntegrityProvider()
          : const AndroidDebugProvider(),
    );
  } catch (e) {
    // App Check only unlocks native send-otp; the bridge covers its absence.
    debugPrint('Firebase init failed: ${e.runtimeType}');
  }
}

/// Uncaught Flutter and async errors go to Crashlytics. Nothing is collected
/// from debug builds.
Future<void> _initCrashlytics() async {
  final crashlytics = FirebaseCrashlytics.instance;
  await crashlytics.setCrashlyticsCollectionEnabled(!kDebugMode);
  final previous = FlutterError.onError;
  FlutterError.onError = (details) {
    previous?.call(details);
    crashlytics.recordFlutterFatalError(details);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    crashlytics.recordError(error, stack, fatal: true);
    return true;
  };
}

class ParkTagApp extends StatefulWidget {
  const ParkTagApp({super.key, required this.app});

  final AppState app;

  @override
  State<ParkTagApp> createState() => _ParkTagAppState();
}

class _ParkTagAppState extends State<ParkTagApp> {
  late final GoRouter _router = buildRouter(widget.app);

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      app: widget.app,
      child: MaterialApp.router(
        title: 'ParkTag',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        routerConfig: _router,
      ),
    );
  }
}
