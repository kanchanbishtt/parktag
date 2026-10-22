import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import '../../core/theme.dart';

class _Slide {
  const _Slide(this.icon, this.title, this.body);

  final IconData icon;
  final String title;
  final String body;
}

const _slides = [
  _Slide(Icons.phone_in_talk_rounded, 'Masked call with your ParkTag',
      'Anyone who scans your sticker can reach you. Your number stays hidden.'),
  _Slide(Icons.sos_rounded, 'Emergency (SOS) contact',
      'Add someone to be reached if something happens with your vehicle.'),
  _Slide(Icons.directions_car_rounded, 'Manage your tags',
      'See your vehicles, tags and recent activity in one place.'),
  _Slide(Icons.pause_circle_rounded, 'Pause calls any time',
      'Busy or away? Pause calls on a tag and turn them back on later.'),
];

/// Four intro slides, shown once. Sets the `onboarded` flag on finish or skip.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _pages = PageController();
  int _index = 0;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    try {
      await AppScope.read(context).api.store.setOnboarded();
    } catch (_) {
      // Storage unavailable: the intro shows again next launch, no harm.
    }
    if (mounted) context.go('/hub');
  }

  void _next() {
    if (_index == _slides.length - 1) {
      _finish();
    } else {
      _pages.nextPage(
          duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    }
  }

  @override
  Widget build(BuildContext context) {
    final last = _index == _slides.length - 1;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(onPressed: _finish, child: const Text('Skip')),
            ),
            Expanded(
              child: PageView(
                controller: _pages,
                onPageChanged: (i) => setState(() => _index = i),
                children: [for (final s in _slides) _SlideView(s)],
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < _slides.length; i++)
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    width: i == _index ? 22 : 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: i == _index ? PtColors.accent : PtColors.line,
                      borderRadius: BorderRadius.circular(PtRadii.pill),
                    ),
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(PtLayout.padX),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _next,
                  child: Text(last ? 'Get started' : 'Next'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SlideView extends StatelessWidget {
  const _SlideView(this.slide);

  final _Slide slide;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 28),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 120,
            height: 120,
            decoration: const BoxDecoration(
                color: PtColors.amberBg, shape: BoxShape.circle),
            child: Icon(slide.icon, size: 56, color: PtColors.accent),
          ),
          const SizedBox(height: 32),
          Text(slide.title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          Text(slide.body,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, color: PtColors.muted)),
        ],
      ),
    );
  }
}
