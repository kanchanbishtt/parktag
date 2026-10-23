import 'package:flutter/material.dart';

/// The web dashboard's page container (`.pt-wc` in owner-welcome.css): a
/// centred column whose gutters and width step up at the stylesheet's
/// breakpoints, so the app lays the same page out at every window width.
///
/// | viewport  | side | max width |
/// | < 640     | 16   | 880       |
/// | >= 640    | 28   | 880       |
/// | >= 1024   | 60   | 1200      |
/// | >= 1400   | 80   | 1400      |
({double side, double maxWidth}) webContentOf(double viewportWidth) =>
    viewportWidth >= 1400
    ? (side: 80, maxWidth: 1400)
    : viewportWidth >= 1024
    ? (side: 60, maxWidth: 1200)
    : viewportWidth >= 640
    ? (side: 28, maxWidth: 880)
    : (side: 16, maxWidth: 880);

class WebContent extends StatelessWidget {
  const WebContent({super.key, required this.child, this.bottom = 120});

  final Widget child;

  /// Under the content: room for the app's floating nav.
  final double bottom;

  @override
  Widget build(BuildContext context) {
    final c = webContentOf(MediaQuery.sizeOf(context).width);
    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: c.maxWidth),
        child: Padding(
          padding: EdgeInsets.fromLTRB(c.side, 0, c.side, bottom),
          child: child,
        ),
      ),
    );
  }
}
